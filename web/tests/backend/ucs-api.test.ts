import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BootstrapSchema, CurrentDocumentSchema } from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function client() {
  const root = await mkdtemp(join(tmpdir(), "pump-ucs-api-"))
  roots.push(root)
  const config = loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot })
  const studio = await createStudioApp(config)
  const response = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await response.json())
  const headers = {
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    "x-csrf-token": bootstrap.csrf_token,
  }
  return { studio, bootstrap, headers, config }
}

describe("native UCS Studio flow", () => {
  it("binds replacement audio atomically with an imported UCS chart", async () => {
    // Given
    const { studio, headers, config } = await client()
    const source = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 0, mode: "Double" }),
    })
    expect(source.status).toBe(200)
    const audio = Uint8Array.from(studio.store.audio().bytes)
    audio[audio.length - 1] = (audio.at(-1) ?? 0) ^ 1
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("chart", new File([await source.text()], "edited.ucs"))
    form.set("audio", new File([audio], "replacement.wav", { type: "audio/wav" }))
    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })
    // Then
    expect(response.status).toBe(200)
    const document = CurrentDocumentSchema.parse(await response.json())
    expect(document.project.music.audio_sha256).toEqual([
      ...createHash("sha256").update(audio).digest(),
    ])
    expect(studio.store.audio().bytes).toEqual(audio)
    expect((await createStudioApp(config)).store.document()).toEqual(document)
  })

  it("exports actual notes then imports exact timing with current audio and persists it", async () => {
    // Given
    const { studio, bootstrap, headers, config } = await client()
    const original = bootstrap.document.project
    const exported = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 0, mode: "Double" }),
    })
    expect(exported.status).toBe(200)
    expect(exported.headers.get("content-type")).toContain("text/plain")
    const text = await exported.text()
    expect(text).toContain(":Format=1\r\n:Mode=Double\r\n")
    expect(text).toContain("M")
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("chart", new File([text], "draft.ucs"))

    // When
    const imported = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })

    // Then
    expect(imported.status).toBe(200)
    const saved = CurrentDocumentSchema.parse(await imported.json())
    expect(saved.revision).toBe(1)
    expect(saved.project.chart).toEqual(original.chart)
    expect(saved.project.music.tempo).toEqual(original.music.tempo)
    expect(saved.project.music.offset_micros).toBe(100_000)
    expect(saved.project.music.audio_sha256).toEqual(original.music.audio_sha256)
    expect(saved.project.audio_asset).toEqual(original.audio_asset)
    expect(saved.project.ucs_mode).toBe("Double")
    const reloaded = await createStudioApp(config)
    expect(reloaded.store.document()).toEqual(saved)
  })

  it("imports Single lanes and section-crossing holds without inventing right-pad notes", async () => {
    // Given
    const { studio, headers } = await client()
    const firstRows = ["M.X..", "H....", "H....", "H...."]
    const secondRows = ["H....", "H....", "W...X", "....."]
    const text = [
      ":Format=1",
      ":Mode=Single",
      ":BPM=120",
      ":Delay=-25",
      ":Beat=4",
      ":Split=4",
      ...firstRows,
      ":BPM=150",
      ":Delay=0",
      ":Beat=4",
      ":Split=4",
      ...secondRows,
    ].join("\r\n")
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("chart", new File([text], "single.ucs"))

    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })

    // Then
    expect(response.status).toBe(200)
    const project = CurrentDocumentSchema.parse(await response.json()).project
    expect(project.ucs_mode).toBe("Single")
    expect(project.music.offset_micros).toBe(-25_000)
    expect(project.music.tempo[1]?.start_tick).toBe(4)
    expect(project.chart.notes).toEqual([
      { tick: 0, panel_mask: 4, hold_ticks: 0 },
      { tick: 0, panel_mask: 1, hold_ticks: 6 },
      { tick: 6, panel_mask: 16, hold_ticks: 0 },
    ])
  })

  it("rejects malformed UCS with a useful native error without altering saved work", async () => {
    // Given
    const { studio, headers, bootstrap } = await client()
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("chart", new File([":Format=1\n:Mode=Double\n:BOGUS=1\n"], "broken.ucs"))
    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })
    // Then
    expect(response.status).toBe(422)
    const result = await response.json()
    expect(result.error.code).toBe("ucs_rejected")
    expect(result.error.message).toMatch(/UCS .*directive|UCS .*unsupported/i)
    expect(studio.store.document()).toEqual(bootstrap.document)
  })

  it("keeps UCS routes behind CSRF and revision checks", async () => {
    // Given
    const { studio, headers } = await client()
    const body = JSON.stringify({ base_revision: 99, mode: "Double" })
    // When
    const csrf = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: headers.cookie },
      body,
    })
    const stale = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    })
    // Then
    expect(csrf.status).toBe(403)
    expect(stale.status).toBe(409)
  })

  it("rejects a UCS that cannot retain the current evaluation contract", async () => {
    // Given
    const { studio, headers, bootstrap } = await client()
    const form = new FormData()
    form.set("base_revision", "0")
    form.set(
      "chart",
      new File(
        [":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=4\nX....\n.....\n"],
        "short.ucs",
      ),
    )
    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })
    // Then
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe("ucs_project_incompatible")
    expect(studio.store.document()).toEqual(bootstrap.document)
  })

  it("bounds UCS bytes before invoking the native parser", async () => {
    // Given
    const { studio, headers, bootstrap } = await client()
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("chart", new File([new Uint8Array(16 * 1024 * 1024 + 1)], "oversized.ucs"))
    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/import", {
      method: "POST",
      headers,
      body: form,
    })
    // Then
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe("ucs_too_large")
    expect(studio.store.document()).toEqual(bootstrap.document)
  })
})
