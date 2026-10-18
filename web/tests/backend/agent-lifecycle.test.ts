import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { AgentRunSnapshotSchema, BootstrapSchema } from "../../shared/index.ts"
import { startFixtureProvider } from "../support/fixture-provider.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("agent run lifecycle", () => {
  it("publishes a redacted failed terminal state when the provider rejects", async () => {
    // Given
    const provider = createServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "secret-provider-detail" } }))
    })
    servers.push(provider)
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve))
    const address = provider.address()
    if (address === null || typeof address === "string")
      throw new TypeError("Missing provider address")
    const client = await createClient(`http://127.0.0.1:${address.port}/v1/chat/completions`)

    // When
    const startedResponse = await client.json("/api/v1/agent/runs", {
      base_revision: client.bootstrap.document.revision,
      prompt: "Inspect the chart.",
    })
    const started = AgentRunSnapshotSchema.parse(await startedResponse.json())
    const eventsResponse = await client.request(`/api/v1/agent/runs/${started.id}/events`, {
      headers: { "x-csrf-token": client.bootstrap.csrf_token },
    })
    const events = await eventsResponse.text()
    const snapshot = AgentRunSnapshotSchema.parse(
      await (await client.request(`/api/v1/agent/runs/${started.id}`)).json(),
    )

    // Then
    expect(snapshot.status).toBe("failed")
    expect(events).toContain('"code":"agent_runtime_failed"')
    expect(events).not.toContain("secret-provider-detail")
  })

  it("cancels a delayed real Part run without creating a late proposal", async () => {
    // Given
    const release = deferred<void>()
    const fixture = await startFixtureProvider(0, { delayToolResponse: release.promise })
    servers.push(fixture.server)
    const client = await createClient(fixture.endpoint.toString())
    const startedResponse = await client.json("/api/v1/agent/runs", {
      base_revision: client.bootstrap.document.revision,
      prompt: "Create a proposal.",
    })
    const started = AgentRunSnapshotSchema.parse(await startedResponse.json())

    // When
    const cancelledResponse = await client.request(`/api/v1/agent/runs/${started.id}`, {
      method: "DELETE",
    })
    release.resolve()
    await client.settled(started.id)
    const refreshed = BootstrapSchema.parse(
      await (await client.request("/api/v1/bootstrap")).json(),
    )

    // Then
    expect(AgentRunSnapshotSchema.parse(await cancelledResponse.json()).status).toBe("cancelled")
    expect(refreshed.proposals).toHaveLength(0)
  })
})

type Client = {
  readonly bootstrap: ReturnType<typeof BootstrapSchema.parse>
  readonly request: (path: string, init?: RequestInit) => Promise<Response>
  readonly json: (path: string, body: unknown) => Promise<Response>
  readonly settled: (id: string) => Promise<void>
}

async function createClient(endpoint: string): Promise<Client> {
  const root = await mkdtemp(join(tmpdir(), "pump-studio-agent-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({
      STUDIO_DATA: root,
      STUDIO_REPO_ROOT: repoRoot,
      PART_ENDPOINT: endpoint,
      PART_MODEL: "fixture-model",
    }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const session = studio.sessions.get(bootstrap.session_id)
  if (session === undefined) throw new TypeError("Bootstrap session is missing")
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set("cookie", cookie)
    if (init.method !== undefined && init.method !== "GET")
      headers.set("x-csrf-token", bootstrap.csrf_token)
    return await studio.app.request(`http://127.0.0.1:4173${path}`, { ...init, headers })
  }
  return {
    bootstrap,
    request,
    settled: (id) => studio.runs.get(session, id).settled(),
    json: (path, body) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (resolveValue === undefined) throw new TypeError("Deferred promise is not initialized")
      resolveValue(value)
    },
  }
}
