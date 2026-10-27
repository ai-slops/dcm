import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { zipSync } from "fflate"
import { afterEach, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BootstrapSchema, ChartDocumentSchema } from "../../shared/index.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("serves retained ZIP timing instead of later mutable chart timing", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-song-template-"))
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
  const archiveBytes = zipSync({
    "charts/main.ucs": new TextEncoder().encode(await exported.text()),
    "audio/music.wav": studio.store.audio().bytes,
  })
  const form = new FormData()
  form.set("library_revision", "0")
  form.set("file", new File([archiveBytes], "song.zip", { type: "application/zip" }))
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
          chart_names: ["charts/main.ucs"],
          title: "Imported",
          artist: "Artist",
        }),
      })
    ).json(),
  )
  const song = imported.library.songs[1]
  const chart = imported.library.charts.find((candidate) => candidate.song_id === song?.id)
  if (song === undefined || chart === undefined) throw new TypeError("Expected imported song")
  const opened = LibraryMutationSchema.parse(
    await (
      await request("/api/v1/library/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "open_chart",
          library_revision: imported.library.revision,
          base_revision: imported.document.revision,
          chart_id: chart.id,
        }),
      })
    ).json(),
  )
  const editedOffset = opened.document.project.music.offset_micros + 1
  await request("/api/v1/document", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base_revision: opened.document.revision,
      project: {
        ...opened.document.project,
        music: { ...opened.document.project.music, offset_micros: editedOffset },
      },
    }),
  })
  const deleted = LibraryMutationSchema.parse(
    await (
      await request("/api/v1/library/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "delete_archive",
          library_revision: opened.library.revision,
          archive_id: archive.id,
        }),
      })
    ).json(),
  )

  // When
  const response = await request(`/api/v1/projects/song-template/${song.id}`)
  const template = ChartDocumentSchema.parse(await response.json())

  // Then
  expect(response.status).toBe(200)
  expect(song.archive_source).toMatchObject({
    chart_name: "charts/main.ucs",
    audio_name: "audio/music.wav",
  })
  expect(deleted.library.songs[1]?.archive_source).toEqual(song.archive_source)
  expect(template.chart.notes).toEqual([])
  expect(template.music.offset_micros).toBe(bootstrap.document.project.music.offset_micros)
  expect(template.music.offset_micros).not.toBe(editedOffset)
  expect(template.music.reference_accents).toEqual([])
  expect(template.audio_asset).toEqual({
    format: song.audio.format,
    byte_length: song.audio.byte_length,
  })
}, 60_000)

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
  const template = ChartDocumentSchema.parse(await response.json())
  expect(template.music.offset_micros).toBe(-375_000)

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
