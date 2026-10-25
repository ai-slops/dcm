import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BootstrapSchema } from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
const origin = "https://studio.example.test"
const authorization = `Basic ${Buffer.from("studio:test-only-password").toString("base64")}`

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function publicStudio() {
  const root = await mkdtemp(join(tmpdir(), "pump-public-"))
  roots.push(root)
  const passwordFile = join(root, "password")
  await writeFile(passwordFile, "studio:test-only-password\n", { mode: 0o600 })
  return createStudioApp(
    loadConfig({
      STUDIO_REPO_ROOT: repoRoot,
      STUDIO_DATA: root,
      STUDIO_PUBLIC_ORIGIN: origin,
      STUDIO_PASSWORD_FILE: passwordFile,
      STUDIO_INSTANCE_ID: "test-instance",
      PART_ENDPOINT: "https://provider.example.test/v1/chat/completions",
      PART_MODEL: "must-not-be-used",
    }),
  )
}

describe("public development access", () => {
  it.each(["/", "/api/v1/bootstrap", "/api/v1/audio", "/assets/example.js"])(
    "requires sign-in before exposing %s, including via a loopback Host",
    async (path) => {
      // Given
      const studio = await publicStudio()
      // When
      const responses = await Promise.all(
        [origin, "http://127.0.0.1:4173"].map((base) => studio.app.request(`${base}${path}`)),
      )
      // Then
      for (const response of responses) {
        expect(response.status).toBe(401)
        expect(response.headers.get("www-authenticate")).toContain("Basic")
        expect(response.headers.get("set-cookie")).toBeNull()
      }
    },
  )

  it("allows authenticated saves while preserving CSRF, secure cookies, and disabled Part", async () => {
    // Given
    const studio = await publicStudio()
    const response = await studio.app.request(`${origin}/api/v1/bootstrap`, {
      headers: { authorization },
    })
    const bootstrap = BootstrapSchema.parse(await response.json())
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
    const headers = { authorization, cookie, origin, "content-type": "application/json" }
    const body = JSON.stringify({
      base_revision: 0,
      project: { ...bootstrap.document.project, title: "Private saved edit" },
    })
    // When
    const denied = await studio.app.request(`${origin}/api/v1/document`, {
      method: "PUT",
      headers,
      body,
    })
    const saved = await studio.app.request(`${origin}/api/v1/document`, {
      method: "PUT",
      headers: { ...headers, "x-csrf-token": bootstrap.csrf_token },
      body,
    })
    // Then
    expect(response.headers.get("set-cookie")).toContain("Secure")
    expect(bootstrap.agent.configured).toBe(false)
    expect(denied.status).toBe(403)
    expect(saved.status).toBe(200)
    expect(studio.store.document().project.title).toBe("Private saved edit")
  })

  it("rejects wrong passwords and foreign origins even with valid sign-in", async () => {
    // Given
    const studio = await publicStudio()
    // When
    const wrong = await studio.app.request(`${origin}/api/v1/bootstrap`, {
      headers: { authorization: "Basic d3Jvbmc6d3Jvbmc=" },
    })
    const foreign = await studio.app.request(`${origin}/api/v1/bootstrap`, {
      headers: { authorization, origin: "https://attacker.test" },
    })
    // Then
    expect(wrong.status).toBe(401)
    expect(foreign.status).toBe(403)
  })

  it("reveals only process readiness without sign-in", async () => {
    // Given
    const studio = await publicStudio()
    // When
    const response = await studio.app.request("http://127.0.0.1:4173/health")
    // Then
    expect(await response.json()).toEqual({
      service: "pump-studio",
      ready: true,
      instance: "test-instance",
    })
  })

  it("accepts the configured HTTPS proxy host without trusting arbitrary forwarded hosts", async () => {
    // Given
    const studio = await publicStudio()
    const headers = {
      host: "172.25.5.2:44157",
      "x-forwarded-host": "studio.example.test",
      "x-forwarded-proto": "https",
    }
    // When
    const signedOut = await studio.app.request("http://172.25.5.2:44157/api/v1/bootstrap", {
      headers,
    })
    const signedIn = await studio.app.request("http://172.25.5.2:44157/api/v1/bootstrap", {
      headers: { ...headers, authorization },
    })
    const foreign = await studio.app.request("http://172.25.5.2:44157/api/v1/bootstrap", {
      headers: { ...headers, authorization, "x-forwarded-host": "attacker.test" },
    })
    // Then
    expect(signedOut.status).toBe(401)
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.get("set-cookie")).toContain("Secure")
    expect(foreign.status).toBe(403)
  })

  it("fails closed when public exposure lacks a password file", () => {
    // Given / When / Then
    expect(() => loadConfig({ STUDIO_PUBLIC_ORIGIN: origin })).toThrow()
  })
})
