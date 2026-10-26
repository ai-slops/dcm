import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, expect, it } from "vitest"

import { loadConfig } from "../../server/config.ts"
import { discoverDimRouter } from "../../server/provider/dim.ts"
import { configurationForModel, resolveAgentProvider } from "../../server/provider/resolve.ts"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

async function routerFixture() {
  const token = "t".repeat(43)
  const server = createServer((request, response) => {
    if (request.url !== "/v1/capabilities" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end()
      return
    }
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify({
        models: [
          { id: "fixture-responses", name: "Responses fixture", api: "responses" },
          { id: "fixture-chat", name: "Chat fixture", api: "chat" },
        ],
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Fixture address missing")
  const origin = `http://127.0.0.1:${address.port}`
  const root = await mkdtemp(join(tmpdir(), "pump-dim-provider-"))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = join(root, "connection.json")
  await writeFile(file, JSON.stringify({ schemaVersion: 1, endpoint: origin, token }), {
    mode: 0o600,
  })
  return { file, origin, token }
}

it("discovers API-specific workspace models without returning private connection values in status", async () => {
  const fixture = await routerFixture()
  const config = loadConfig({
    STUDIO_AGENT_PROVIDER: "dim",
    STUDIO_AGENT_MODEL: "fixture-responses",
    DIM_LLM_ROUTER_CONNECTION_FILE: fixture.file,
  })
  const resolved = await resolveAgentProvider(config)
  expect(resolved.status.model).toBe("fixture-responses")
  expect(resolved.status.api).toBe("responses")
  expect(JSON.stringify(resolved.status)).not.toContain(fixture.token)
  expect(JSON.stringify(resolved.status)).not.toContain(fixture.origin)
  expect((await configurationForModel(config, "fixture-chat")).endpoint.pathname).toBe(
    "/v1/chat/completions",
  )
  expect((await configurationForModel(config, "fixture-responses")).endpoint.pathname).toBe(
    "/v1/responses",
  )
  await expect(configurationForModel(config, "not-catalogued")).rejects.toMatchObject({
    code: "agent_model_unavailable",
  })
})

it("reports missing router configuration without breaking the chart application or leaking paths", async () => {
  const resolved = await resolveAgentProvider(
    loadConfig({
      STUDIO_AGENT_PROVIDER: "dim",
      DIM_LLM_ROUTER_CONNECTION_FILE: "/missing/private-router-file",
    }),
  )
  expect(resolved.status.configured).toBe(false)
  expect(resolved.status.message).toContain("workspace")
  expect(JSON.stringify(resolved.status)).not.toContain("/missing/private-router-file")
})

it("rejects a non-private connection file before using its credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "pump-dim-permissions-"))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = join(root, "connection.json")
  await writeFile(
    file,
    JSON.stringify({ schemaVersion: 1, endpoint: "http://127.0.0.1", token: "t".repeat(43) }),
    { mode: 0o644 },
  )
  await chmod(file, 0o644)
  await expect(discoverDimRouter(file)).rejects.toMatchObject({
    code: "dim_connection_permissions",
  })
})
