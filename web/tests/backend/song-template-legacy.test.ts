import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { zipSync } from "fflate"
import { afterEach, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BeatChartDocumentSchema, BootstrapSchema } from "../../shared/index.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("resolves a legacy multi-chart source by full path and matching audio digest", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-legacy-song-template-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set("cookie", cookie)
    if (init.method !== undefined && init.method !== "GET")
      headers.set("x-csrf-token", bootstrap.csrf_token)
    return studio.app.request(`http://127.0.0.1:4173${path}`, { ...init, headers })
  }
  const exported = await request("/api/v1/ucs/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_revision: 0, mode: "Double" }),
  })
  const first = (await exported.text()).replace(/:Delay=[^\r\n]+/, ":Delay=-250")
  const second = first.replace(/:Delay=[^\r\n]+/, ":Delay=-375")
  const archiveBytes = zipSync({
    "charts/first.ucs": new TextEncoder().encode(first),
    "charts/second.ucs": new TextEncoder().encode(second),
    "audio/decoy.wav": new Uint8Array(),
    "audio/music.wav": studio.store.audio().bytes,
  })
  const form = new FormData()
  form.set("library_revision", "0")
  form.set("file", new File([archiveBytes], "legacy.zip", { type: "application/zip" }))
  const staged = LibraryMutationSchema.parse(
    await (await request("/api/v1/library/archives", { method: "POST", body: form })).json(),
  )
  const archive = staged.library.archives[0]
  if (archive === undefined) throw new TypeError("Expected staged archive")
  const imported = LibraryMutationSchema.parse(
    await (
      await request("/api/v1/library/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "import_archive",
          library_revision: staged.library.revision,
          archive_id: archive.id,
          audio_name: "audio/music.wav",
          chart_names: ["charts/second.ucs"],
          title: "Legacy",
          artist: "Artist",
        }),
      })
    ).json(),
  )
  const song = imported.library.songs[1]
  if (song === undefined) throw new TypeError("Expected imported song")
  const documentPath = join(root, "document.json")
  const persisted = JSON.parse(await readFile(documentPath, "utf8"))
  delete persisted.library.songs[1].archive_source
  await writeFile(documentPath, `${JSON.stringify(persisted)}\n`)
  const reopened = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const reopenedBootstrap = await reopened.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const reopenedCookie = reopenedBootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? ""

  // When
  const response = await reopened.app.request(
    `http://127.0.0.1:4173/api/v1/projects/song-template/${song.id}`,
    { headers: { cookie: reopenedCookie } },
  )

  // Then
  expect(response.status).toBe(200)
  const template = BeatChartDocumentSchema.parse(await response.json())
  expect(template.timing.offset_micros).toBe(-375_000)

  const ambiguousState = JSON.parse(await readFile(documentPath, "utf8"))
  const legacyChart = ambiguousState.library.charts.find(
    (candidate: { readonly song_id: string }) => candidate.song_id === song.id,
  )
  if (legacyChart === undefined) throw new TypeError("Expected legacy chart")
  legacyChart.name = "Renamed chart"
  await writeFile(documentPath, `${JSON.stringify(ambiguousState)}\n`)
  const ambiguousApp = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const ambiguousBootstrap = await ambiguousApp.app.request(
    "http://127.0.0.1:4173/api/v1/bootstrap",
  )
  const ambiguousCookie = ambiguousBootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const ambiguous = await ambiguousApp.app.request(
    `http://127.0.0.1:4173/api/v1/projects/song-template/${song.id}`,
    { headers: { cookie: ambiguousCookie } },
  )
  expect(ambiguous.status).toBe(409)
  expect(await ambiguous.json()).toMatchObject({ error: { code: "archive_source_ambiguous" } })
}, 60_000)

it("preserves a legacy archive fallback grid whose global TPB exceeds the edit default", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-high-tpb-song-template-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set("cookie", cookie)
    if (init.method !== undefined && init.method !== "GET")
      headers.set("x-csrf-token", bootstrap.csrf_token)
    return studio.app.request(`http://127.0.0.1:4173${path}`, { ...init, headers })
  }
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => (index === 0 ? "X........." : ".........."))
  const chart = [
    ":Format=1",
    ":Mode=Double",
    ":BPM=120",
    ":Delay=0",
    ":Beat=4",
    ":Split=63",
    ...rows(63),
    ":BPM=120",
    ":Delay=0",
    ":Beat=4",
    ":Split=64",
    ...rows(64),
  ].join("\r\n")
  const archiveBytes = zipSync({
    "chart.ucs": new TextEncoder().encode(chart),
    "music.wav": studio.store.audio().bytes,
  })
  const form = new FormData()
  form.set("library_revision", "0")
  form.set("file", new File([archiveBytes], "legacy-grid.zip", { type: "application/zip" }))
  const staged = LibraryMutationSchema.parse(
    await (await request("/api/v1/library/archives", { method: "POST", body: form })).json(),
  )
  const archive = staged.library.archives[0]
  const song = staged.library.songs[0]
  if (archive === undefined || song === undefined)
    throw new Error("Expected staged archive and song")
  const documentPath = join(root, "document.json")
  const persisted = JSON.parse(await readFile(documentPath, "utf8"))
  persisted.library.songs[0].archive_id = archive.id
  delete persisted.library.songs[0].archive_source
  await writeFile(documentPath, `${JSON.stringify(persisted)}\n`)
  const reopened = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const reopenedBootstrap = await reopened.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const reopenedCookie = reopenedBootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? ""

  // When
  const response = await reopened.app.request(
    `http://127.0.0.1:4173/api/v1/projects/song-template/${song.id}`,
    { headers: { cookie: reopenedCookie } },
  )

  // Then
  expect(response.status).toBe(200)
  const template = BeatChartDocumentSchema.parse(await response.json())
  expect(template.timing.grid_sections).toEqual([
    { at: { numerator: 0, denominator: 1 }, rows_per_measure: 16_128 },
  ])
  expect(template.timing.duration).toEqual({ numerator: 2, denominator: 1 })
}, 60_000)
