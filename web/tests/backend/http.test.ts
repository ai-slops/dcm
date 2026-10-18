import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("studio HTTP API", () => {
  it("serves optimized public assets without applying those policies to private API JSON", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-studio-static-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )
    const indexResponse = await studio.app.request("http://127.0.0.1:4173/")
    const index = await indexResponse.text()
    const assetPath = index.match(/\/assets\/[^"]+\.js/)?.[0]
    expect(assetPath).toBeDefined()

    // When
    const asset = await studio.app.request(`http://127.0.0.1:4173${assetPath}`, {
      headers: { "accept-encoding": "gzip" },
    })
    const font = await studio.app.request("http://127.0.0.1:4173/fonts/satoshi-variable.woff2")
    const compressedIndex = await studio.app.request("http://127.0.0.1:4173/", {
      headers: { "accept-encoding": "gzip" },
    })
    const bootstrap = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap", {
      headers: { "accept-encoding": "gzip" },
    })

    // Then
    expect(index).toContain("<style>")
    expect(index).not.toMatch(/<link[^>]+rel="stylesheet"/)
    expect(asset.headers.get("content-encoding")).toBe("gzip")
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(font.headers.get("cache-control")).toBe("public, max-age=604800")
    expect(compressedIndex.headers.get("content-encoding")).toBe("gzip")
    expect(bootstrap.headers.get("content-encoding")).toBeNull()
    expect(bootstrap.headers.get("cache-control")).toBeNull()
  })

  it("serves a valid robots policy that excludes API routes", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-studio-robots-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )

    // When
    const response = await studio.app.request("http://127.0.0.1:4173/robots.txt")

    // Then
    expect(response.headers.get("content-type")).toContain("text/plain")
    expect(await response.text()).toBe("User-agent: *\nDisallow: /api/\n")
  })

  it("persists an explicitly saved document with revision and CSRF guards", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-studio-http-"))
    roots.push(root)
    const config = loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot })
    const first = await createStudioApp(config)
    const bootstrapResponse = await first.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
    const bootstrap = await bootstrapResponse.json()
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""

    // When
    const denied = await first.app.request("http://127.0.0.1:4173/api/v1/document", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ base_revision: 0, project: bootstrap.document.project }),
    })
    const saved = await first.app.request("http://127.0.0.1:4173/api/v1/document", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": bootstrap.csrf_token,
      },
      body: JSON.stringify({
        base_revision: 0,
        project: { ...bootstrap.document.project, title: "Persisted" },
      }),
    })
    const reloaded = await createStudioApp(config)
    const reloadedBootstrap = await reloaded.app.request("http://127.0.0.1:4173/api/v1/bootstrap")

    // Then
    expect(denied.status).toBe(403)
    expect(saved.status).toBe(200)
    expect((await saved.json()).revision).toBe(1)
    expect((await reloadedBootstrap.json()).document.project.title).toBe("Persisted")
  })

  it("rejects foreign hosts and oversized JSON", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-studio-security-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )

    // When
    const foreign = await studio.app.request("http://attacker.test/api/v1/bootstrap")
    const oversized = await studio.app.request("http://127.0.0.1:4173/api/v1/document", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "content-length": String(8 * 1024 * 1024 + 1),
      },
      body: "x".repeat(8 * 1024 * 1024 + 1),
    })

    // Then
    expect(foreign.status).toBe(403)
    expect(oversized.status).toBe(413)
  })
})
