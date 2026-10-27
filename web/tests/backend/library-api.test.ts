import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unzipSync, zipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BootstrapSchema } from "../../shared/index.ts"
import {
  LibraryChartDocumentSchema,
  LibraryMutationSchema,
  LibrarySnapshotSchema,
} from "../../shared/library.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Studio library API", () => {
  it("validates catalog searches through the authenticated library route", async () => {
    // Given
    const client = await libraryClient()

    // When
    const response = await client.request("/api/v1/library/catalog?query=")

    // Then
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "catalog_query" } })
  })

  it("rejects malformed asset IDs before store lookup", async () => {
    // Given
    const client = await libraryClient()

    // When
    const [audio, archive] = await Promise.all([
      client.request("/api/v1/library/songs/not-a-uuid/audio"),
      client.request("/api/v1/library/archives/not-a-uuid/file"),
    ])

    // Then
    expect(audio.status).toBe(400)
    expect(archive.status).toBe(400)
  })

  it("creates an empty-audio song and opens its initial chart atomically", async () => {
    // Given
    const client = await libraryClient()
    const form = new FormData()
    form.set(
      "input",
      JSON.stringify({
        library_revision: 0,
        base_revision: 0,
        title: "新しい曲",
        artist: "作者",
        chart_name: "Challenge",
        mode: "Double",
        bpm: 137.5,
        beats: 16,
      }),
    )

    // When
    const response = await client.request("/api/v1/library/songs", { method: "POST", body: form })

    // Then
    expect(response.status).toBe(200)
    const mutation = LibraryMutationSchema.parse(await response.json())
    expect(mutation.document.revision).toBe(1)
    expect(mutation.library.revision).toBe(1)
    expect(mutation.library.songs).toHaveLength(2)
    expect(mutation.library.songs[1]?.audio).toMatchObject({
      byte_length: 0,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    })
    expect(mutation.document.project.music).toMatchObject({
      duration_ticks: 768,
      ticks_per_beat: 48,
    })
  })

  it("requires a fallback before deleting the active or last chart", async () => {
    // Given
    const client = await libraryClient()
    const library = LibrarySnapshotSchema.parse(
      await (await client.request("/api/v1/library")).json(),
    )

    // When
    const response = await client.json("/api/v1/library/actions", {
      type: "delete_chart",
      library_revision: library.revision,
      chart_id: library.active_chart_id,
      base_revision: 0,
    })

    // Then
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "last_chart" } })
  })

  it("renames metadata without replacing edited chart content", async () => {
    // Given
    const client = await libraryClient()
    const library = LibrarySnapshotSchema.parse(
      await (await client.request("/api/v1/library")).json(),
    )
    const song = library.songs[0]
    expect(song).toBeDefined()
    if (song === undefined) return

    // When
    const response = await client.json("/api/v1/library/actions", {
      type: "rename_song",
      library_revision: library.revision,
      song_id: song.id,
      title: "曲名 🎵",
      artist: "演奏者",
    })

    // Then
    const mutation = LibraryMutationSchema.parse(await response.json())
    expect(mutation.library.songs[0]).toMatchObject({ title: "曲名 🎵", artist: "演奏者" })
    expect(mutation.document).toEqual(client.bootstrap.document)
  })

  it("refuses to delete the only chart belonging to a retained song", async () => {
    // Given
    const client = await libraryClient()
    const initial = LibrarySnapshotSchema.parse(
      await (await client.request("/api/v1/library")).json(),
    )
    const original = initial.charts[0]
    if (original === undefined) return
    const form = new FormData()
    form.set(
      "input",
      JSON.stringify({
        library_revision: initial.revision,
        base_revision: client.bootstrap.document.revision,
        title: "Second",
        artist: "Artist",
        chart_name: "Main",
        mode: "Double",
        bpm: 120,
        beats: 16,
      }),
    )
    const created = LibraryMutationSchema.parse(
      await (await client.request("/api/v1/library/songs", { method: "POST", body: form })).json(),
    )

    // When
    const response = await client.json("/api/v1/library/actions", {
      type: "delete_chart",
      library_revision: created.library.revision,
      chart_id: original.id,
    })

    // Then
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "last_song_chart" } })
  })

  it("stages and imports a real UCS ZIP without changing the active chart", async () => {
    // Given
    const client = await libraryClient()
    const exported = await client.request("/api/v1/ucs/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 0, mode: "Double" }),
    })
    const archiveBytes = zipSync({
      "charts/main.ucs": new TextEncoder().encode(await exported.text()),
      "audio/music.wav": client.studio.store.audio().bytes,
    })
    const form = new FormData()
    form.set("library_revision", "0")
    form.set("file", new File([archiveBytes], "song.zip", { type: "application/zip" }))
    const stagedResponse = await client.request("/api/v1/library/archives", {
      method: "POST",
      body: form,
    })
    const staged = LibraryMutationSchema.parse(await stagedResponse.json())
    const archive = staged.library.archives[0]
    if (archive === undefined) return

    // When
    const importedResponse = await client.json("/api/v1/library/actions", {
      type: "import_archive",
      library_revision: staged.library.revision,
      archive_id: archive.id,
      audio_name: "audio/music.wav",
      chart_names: ["charts/main.ucs"],
      title: "Imported",
      artist: "Artist",
    })

    // Then
    expect(importedResponse.status).toBe(200)
    const imported = LibraryMutationSchema.parse(await importedResponse.json())
    expect(imported.document).toEqual(client.bootstrap.document)
    expect(imported.library.songs).toHaveLength(2)
    const file = await client.request(`/api/v1/library/archives/${archive.id}/file`)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(archiveBytes)
    const corrupted = Uint8Array.from(archiveBytes)
    corrupted[0] = (corrupted[0] ?? 0) ^ 1
    await writeFile(join(client.root, "archives", `${archive.sha256}.zip`), corrupted)
    const corruptResponse = await client.request(`/api/v1/library/archives/${archive.id}/file`)
    expect(corruptResponse.status).toBe(500)
    expect(await corruptResponse.json()).toMatchObject({ error: { code: "archive_corrupt" } })
    const song = imported.library.songs[1]
    if (song === undefined) return
    const bundle = await client.request(`/api/v1/library/songs/${song.id}/export`)
    expect(Object.keys(unzipSync(new Uint8Array(await bundle.arrayBuffer()))).sort()).toEqual([
      "charts_main.ucs",
      "music.wav",
      "pump-library.json",
    ])
  }, 60_000)

  it("rebinds every chart of the active song through the legacy audio route", async () => {
    // Given
    const client = await libraryClient()
    const initial = LibrarySnapshotSchema.parse(
      await (await client.request("/api/v1/library")).json(),
    )
    const source = initial.charts[0]
    if (source === undefined) return
    const duplicateResponse = await client.json("/api/v1/library/actions", {
      type: "duplicate_chart",
      library_revision: initial.revision,
      chart_id: source.id,
      name: "Copy",
    })
    const duplicated = LibraryMutationSchema.parse(await duplicateResponse.json())
    const audio = Uint8Array.from(client.studio.store.audio().bytes)
    audio[audio.length - 1] = (audio.at(-1) ?? 0) ^ 1
    const form = new FormData()
    form.set("base_revision", "0")
    form.set("audio", new File([audio], "replacement.wav", { type: "audio/wav" }))

    // When
    const replaced = await client.request("/api/v1/audio", { method: "PUT", body: form })

    // Then
    expect(replaced.status).toBe(200)
    const projects = await Promise.all(
      duplicated.library.charts.map(
        async (chart) =>
          LibraryChartDocumentSchema.parse(
            await (await client.request(`/api/v1/library/charts/${chart.id}`)).json(),
          ).project,
      ),
    )
    expect(
      new Set(projects.map((project) => JSON.stringify(project.music.audio_sha256))).size,
    ).toBe(1)
    expect(projects.every((project) => project.audio_asset.byte_length === audio.byteLength)).toBe(
      true,
    )
  })
})

async function libraryClient() {
  const root = await mkdtemp(join(tmpdir(), "pump-library-api-"))
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
  return {
    root,
    studio,
    bootstrap,
    request,
    json: (path: string, body: unknown) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}
