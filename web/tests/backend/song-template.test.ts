import { mkdtemp, rm } from "node:fs/promises"
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
  const editedOffset = opened.document.project.timing.offset_micros + 1
  await request("/api/v1/document", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base_revision: opened.document.revision,
      project: {
        ...opened.document.project,
        timing: { ...opened.document.project.timing, offset_micros: editedOffset },
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
  const template = BeatChartDocumentSchema.parse(await response.json())
  const baseSourcesResponse = await request(`/api/v1/projects/base-sources/${song.id}`)
  const baseSources = await baseSourcesResponse.json()
  const createdResponse = await request("/api/v1/projects/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "create_project",
      song_id: song.id,
      mode: template.mode,
      name: "Retained archive timing",
      chart_artist: "Retained Author",
      base_ucs_ref: { source: "retained_timing", song_id: song.id },
      timing: { ...template.timing, duration: null },
      evaluation_contract: template.evaluation_contract,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [],
        regions: [],
      },
    }),
  })
  const created = await createdResponse.json()

  // Then
  expect(response.status).toBe(200)
  expect(song.archive_source).toMatchObject({
    chart_name: "charts/main.ucs",
    audio_name: "audio/music.wav",
  })
  expect(deleted.library.songs[1]?.archive_source).toEqual(song.archive_source)
  expect(template.notes).toEqual([])
  expect(template.timing.offset_micros).toBe(bootstrap.document.project.timing.offset_micros)
  expect(template.timing.offset_micros).not.toBe(editedOffset)
  expect(template.timing.reference_accents).toEqual([])
  expect(template.audio_asset).toEqual({
    format: song.audio.format,
    byte_length: song.audio.byte_length,
  })
  expect(baseSourcesResponse.status).toBe(200)
  expect(baseSources).toContainEqual({
    ref: { source: "retained_timing", song_id: song.id },
    label: "Original archive timing",
    mode: song.archive_source?.mode,
    timing: song.archive_source?.timing,
  })
  expect(createdResponse.status).toBe(200)
  expect(created).toMatchObject({
    project: {
      base_ucs_ref: { source: "retained_timing", song_id: song.id },
      timing: { ...song.archive_source?.timing, duration: null },
    },
  })
}, 60_000)
