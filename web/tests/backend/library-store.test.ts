import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { LibraryService } from "../../server/library/service.ts"
import { chartSummary } from "../../server/library/state.ts"
import { StudioStore } from "../../server/store.ts"
import { LibraryCommandSchema, NewSongSchema } from "../../shared/library-commands.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Studio library persistence", () => {
  it("summarizes panel contacts rather than grouped note records", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const project = {
      ...demo.document.project,
      chart: {
        ...demo.document.project.chart,
        notes: demo.document.project.chart.notes.map((note, index) =>
          index === 0 ? { ...note, panel_mask: 3 } : note,
        ),
      },
    }

    // When
    const summary = chartSummary(project)

    // Then
    expect(summary.note_count).toBe(5)
    expect(summary.hold_count).toBe(5)
  })

  it("migrates the legacy document once while preserving its revision and audio", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-store-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    await StudioStore.open(root, demo.document, demo.audio)
    const legacy = JSON.parse(await readFile(join(root, "document.json"), "utf8"))
    await writeFile(join(root, "document.json"), `${JSON.stringify(legacy.document)}\n`)

    // When
    const migrated = await StudioStore.open(root, demo.document, demo.audio)

    // Then
    expect(migrated.document()).toEqual(demo.document)
    expect(migrated.library().songs).toHaveLength(1)
    expect(migrated.library().charts).toHaveLength(1)
    expect(migrated.library().active_chart_id).toBe(migrated.library().charts[0]?.id)
    expect(JSON.parse(await readFile(join(root, "document.json"), "utf8"))).toMatchObject({
      version: 2,
      document: demo.document,
    })
  })

  it("synchronizes a normal save into the active stored chart", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-store-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const active = store.library().active_chart_id
    const project = {
      ...demo.document.project,
      chart: { ...demo.document.project.chart, notes: [] },
    }

    // When
    const saved = await store.save(demo.document.revision, project)

    // Then
    expect(saved.revision).toBe(1)
    expect(store.chartDocument(active).project.chart.notes).toEqual([])
  })

  it("increments the library revision when save changes canonical UCS mode", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-mode-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)

    // When
    await store.save(store.document().revision, { ...demo.document.project, ucs_mode: "Single" })
    const afterSingle = store.library()
    await store.save(store.document().revision, demo.document.project)

    // Then
    expect(afterSingle.revision).toBe(1)
    expect(afterSingle.charts[0]?.mode).toBe("Single")
    expect(store.library().revision).toBe(2)
    expect(store.library().charts[0]?.mode).toBe("Double")
  })

  it("preserves independently renamed library labels when an older project draft is saved", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-labels-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const song = store.library().songs[0]
    expect(song).toBeDefined()
    if (song === undefined) throw new Error("Expected initial song")
    await new LibraryService(store).command(
      LibraryCommandSchema.parse({
        type: "rename_song",
        library_revision: 0,
        song_id: song.id,
        title: "Library rename",
        artist: "Library artist",
      }),
    )

    // When
    await store.save(0, { ...demo.document.project, title: "Older document rename" })

    // Then
    expect(store.library().songs[0]).toMatchObject({
      title: "Library rename",
      artist: "Library artist",
    })
    expect(store.document().project.title).toBe("Older document rename")
  })

  it("restores a legacy mode-omitted project after opening a Single chart", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-restore-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const single = { ...demo.document.project, ucs_mode: "Single" as const }
    await store.save(store.document().revision, single)

    // When
    const restored = await store.replace(
      store.document().revision,
      demo.document.project,
      demo.audio,
    )

    // Then
    expect(restored.project).toEqual(demo.document.project)
    expect(store.chartDocument(store.library().active_chart_id).chart.mode).toBe("Double")
  })

  it("does not publish a chart switch when its active audio asset is missing", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-store-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const library = new LibraryService(store)
    const originalChart = store.library().active_chart_id
    const created = await library.createSong(
      NewSongSchema.parse({
        library_revision: 0,
        base_revision: 0,
        title: "Missing asset",
        artist: "Test",
        chart_name: "Main",
        mode: "Double",
        bpm: 120,
        beats: 16,
      }),
      {
        bytes: new Uint8Array(),
        digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        format: "wav",
      },
    )
    const missingChart = created.library.active_chart_id
    const missingSong = created.library.songs.find((song) => song.title === "Missing asset")
    if (missingSong === undefined) return
    await library.command(
      LibraryCommandSchema.parse({
        type: "open_chart",
        library_revision: created.library.revision,
        base_revision: created.document.revision,
        chart_id: originalChart,
      }),
    )
    const beforeDocument = store.document()
    const beforeDisk = await readFile(join(root, "document.json"), "utf8")
    await unlink(join(root, "audio", `${missingSong.audio.sha256}.${missingSong.audio.format}`))

    // When
    const opened = library.command(
      LibraryCommandSchema.parse({
        type: "open_chart",
        library_revision: store.library().revision,
        base_revision: store.document().revision,
        chart_id: missingChart,
      }),
    )

    // Then
    await expect(opened).rejects.toBeInstanceOf(Error)
    expect(store.document()).toEqual(beforeDocument)
    expect(await readFile(join(root, "document.json"), "utf8")).toBe(beforeDisk)
  })

  it("rejects a persisted library with duplicate songs that have no owned chart", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-store-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    await StudioStore.open(root, demo.document, demo.audio)
    const path = join(root, "document.json")
    const state = JSON.parse(await readFile(path, "utf8"))
    state.library.songs.push(structuredClone(state.library.songs[0]))
    await writeFile(path, `${JSON.stringify(state)}\n`)

    // When
    const reopened = StudioStore.open(root, demo.document, demo.audio)

    // Then
    await expect(reopened).rejects.toBeInstanceOf(Error)
  })
})
