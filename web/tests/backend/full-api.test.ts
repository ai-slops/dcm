import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unzipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import {
  AgentRunSnapshotSchema,
  BootstrapSchema,
  ChartProposalSchema,
  CurrentDocumentSchema,
} from "../../shared/index.ts"
import { startFixtureProvider } from "../support/fixture-provider.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("complete studio HTTP API", () => {
  it("serves byte ranges and replaces content-addressed audio", async () => {
    // Given
    const client = await createClient()
    const original = await client.request("/api/v1/audio")
    const originalBytes = new Uint8Array(await original.arrayBuffer())
    const form = new FormData()
    form.set("base_revision", String(client.bootstrap.document.revision))
    form.set("audio", new File([originalBytes], "replacement.wav", { type: "audio/wav" }))

    // When
    const ranged = await client.request("/api/v1/audio", { headers: { range: "bytes=0-9" } })
    const replaced = await client.request("/api/v1/audio", { method: "PUT", body: form })

    // Then
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("content-range")).toBe(`bytes 0-9/${originalBytes.byteLength}`)
    expect((await ranged.arrayBuffer()).byteLength).toBe(10)
    expect(CurrentDocumentSchema.parse(await replaced.json()).revision).toBe(1)
  })

  it("evaluates, generates, applies, and exports through the native CLI", async () => {
    // Given
    const client = await createClient()
    const revision = client.bootstrap.document.revision

    // When
    const evaluation = await client.json("/api/v1/evaluations", { base_revision: revision })
    const generatedResponse = await client.json("/api/v1/generations", {
      base_revision: revision,
      seed: "0".repeat(64),
    })
    const proposal = ChartProposalSchema.parse(await generatedResponse.json())
    const appliedResponse = await client.json(`/api/v1/proposals/${proposal.id}/apply`, {
      base_revision: revision,
    })
    const applied = CurrentDocumentSchema.parse(await appliedResponse.json())
    const exported = await client.json("/api/v1/exports", { base_revision: applied.revision })
    const archive = unzipSync(new Uint8Array(await exported.arrayBuffer()))

    // Then
    expect(evaluation.status).toBe(200)
    expect(proposal.source).toBe("native_generate")
    expect(applied.project.chart).toEqual(proposal.chart)
    expect(exported.headers.get("content-type")).toBe("application/zip")
    expect(Object.keys(archive).sort()).toEqual([
      "chart.ssc",
      "edited-export.json",
      "music.wav",
      "project.json",
    ])
  }, 60_000)

  it("streams a real Part tool run and keeps its chart as an unapplied proposal", async () => {
    // Given
    const fixture = await startFixtureProvider()
    closers.push(() => new Promise<void>((resolve) => fixture.server.close(() => resolve())))
    const client = await createClient({
      PART_ENDPOINT: fixture.endpoint.toString(),
      PART_MODEL: "fixture-model",
    })

    // When
    const startedResponse = await client.json("/api/v1/agent/runs", {
      base_revision: client.bootstrap.document.revision,
      prompt: "Create a reviewable copy of the current chart.",
    })
    const started = AgentRunSnapshotSchema.parse(await startedResponse.json())
    const eventsResponse = await client.request(`/api/v1/agent/runs/${started.id}/events`, {
      headers: { "x-csrf-token": client.bootstrap.csrf_token },
    })
    const eventText = await eventsResponse.text()
    const refreshed = BootstrapSchema.parse(
      await (await client.request("/api/v1/bootstrap")).json(),
    )

    // Then
    expect(startedResponse.status).toBe(202)
    expect(eventsResponse.status).toBe(200)
    expect(eventText).toContain("event: proposal")
    expect(eventText).toContain("event: completed")
    expect(refreshed.document.revision).toBe(client.bootstrap.document.revision)
    expect(refreshed.proposals).toHaveLength(1)
    expect(refreshed.proposals?.[0]?.chart).not.toEqual(client.bootstrap.document.project.chart)
  })
})

type Client = {
  readonly bootstrap: ReturnType<typeof BootstrapSchema.parse>
  readonly request: (path: string, init?: RequestInit) => Promise<Response>
  readonly json: (path: string, body: unknown) => Promise<Response>
}

async function createClient(extraEnvironment: NodeJS.ProcessEnv = {}): Promise<Client> {
  const root = await mkdtemp(join(tmpdir(), "pump-studio-full-api-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot, ...extraEnvironment }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set("cookie", cookie)
    if (init.method !== undefined && init.method !== "GET") {
      headers.set("x-csrf-token", bootstrap.csrf_token)
    }
    return await studio.app.request(`http://127.0.0.1:4173${path}`, { ...init, headers })
  }
  return {
    bootstrap,
    request,
    json: (path, body) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}
