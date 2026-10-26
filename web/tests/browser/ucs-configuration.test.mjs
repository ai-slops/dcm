import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { browserConfiguration } from "./ucs-support.mjs"

let root
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pump-browser-config-"))
  vi.stubEnv("STUDIO_BROWSER_STATE_FILE", join(root, "state.json"))
  vi.stubEnv("STUDIO_BROWSER_URL", "http://127.0.0.1:4173")
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

it("uses an explicit local URL without managed preview state", () => {
  const configuration = browserConfiguration()
  expect(configuration.url).toBe("http://127.0.0.1:4173/")
  expect(configuration.context.httpCredentials).toBeUndefined()
})

it("reads a private credential beside an explicitly selected matching state file", async () => {
  await writeFile(
    join(root, "state.json"),
    JSON.stringify({ local: false, origin: "https://studio.example.test/" }),
  )
  await writeFile(join(root, "password"), "studio:test-only-credential\n", { mode: 0o600 })
  vi.stubEnv("STUDIO_BROWSER_URL", "https://studio.example.test/")
  expect(browserConfiguration().context.httpCredentials).toEqual({
    username: "studio",
    password: "test-only-credential",
  })
})

it("never reads a managed credential for an unrelated target origin", async () => {
  await writeFile(
    join(root, "state.json"),
    JSON.stringify({ local: false, origin: "https://studio.example.test/" }),
  )
  vi.stubEnv("STUDIO_BROWSER_URL", "https://unrelated.example.test/")
  expect(browserConfiguration().context.httpCredentials).toBeUndefined()
})

it("rejects URL credentials without retaining their value in assertion diagnostics", () => {
  vi.stubEnv("STUDIO_BROWSER_URL", "https://test-user:test-only-sentinel@studio.example.test/")
  let rejection
  try {
    browserConfiguration()
  } catch (error) {
    rejection = error
  }
  expect(rejection).toBeInstanceOf(Error)
  expect(rejection).not.toHaveProperty("actual")
  expect(JSON.stringify(rejection)).not.toContain("test-only-sentinel")
})
