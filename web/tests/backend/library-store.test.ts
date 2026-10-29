import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { migrateLegacyChart } from "../../server/library/legacy-beat-migration.ts"
import { LibraryService } from "../../server/library/service.ts"
import { initialState } from "../../server/library/state.ts"
import { beatChartSummary } from "../../server/library/state-v4.ts"
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
    const migrated = migrateLegacyChart(demo.document.project)
    const project = {
      ...migrated,
      notes: migrated.notes.map((note, index) => (index === 0 ? { ...note, panel_mask: 3 } : note)),
    }

    // When
    const summary = beatChartSummary(project)

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
    await writeFile(join(root, "document.json"), `${JSON.stringify(demo.document)}\n`)

    // When
    const migrated = await StudioStore.open(root, demo.document, demo.audio)

    // Then
    expect(migrated.document().project).toEqual(migrateLegacyChart(demo.document.project))
    expect(migrated.library().songs).toHaveLength(1)
    expect(migrated.library().charts).toHaveLength(1)
    expect(migrated.library().active_chart_id).toBe(migrated.library().charts[0]?.id)
    expect(JSON.parse(await readFile(join(root, "document.json"), "utf8"))).toMatchObject({
      version: 4,
      projects: { revision: 0, selected_project_id: null, records: [], components: [] },
    })
  })

  it("synchronizes a normal save into the active stored chart", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-store-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const active = store.library().active_chart_id
    const current = store.document()
    const project = {
      ...current.project,
      notes: [],
    }

    // When
    const saved = await store.save(current.revision, project)

    // Then
    expect(saved.revision).toBe(1)
    expect(store.chartDocument(active).project.notes).toEqual([])
  })

  it("rejects changing canonical UCS mode through normal save", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-mode-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const current = store.document()

    const changed = store.save(store.document().revision, {
      ...current.project,
      mode: "Single",
    })

    // Then
    await expect(changed).rejects.toMatchObject({ code: "chart_mode_immutable" })
    expect(store.library().revision).toBe(0)
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
    await store.save(0, { ...store.document().project, title: "Older document rename" })

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
    const library = new LibraryService(store)
    const song = store.library().songs[0]
    if (song === undefined) throw new Error("Expected initial song")
    await library.command(
      LibraryCommandSchema.parse({
        type: "new_chart",
        library_revision: 0,
        base_revision: 0,
        song_id: song.id,
        name: "Single",
        mode: "Single",
      }),
    )

    // When
    const original = migrateLegacyChart(demo.document.project)
    const restored = await store.replace(store.document().revision, original, demo.audio)

    // Then
    expect(restored.project).toEqual(original)
    expect(store.chartDocument(store.library().active_chart_id).chart.mode).toBe("Double")
  })

  it("rejects migration of explicit Single charts containing right-pad notes", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-library-mode-migration-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    await StudioStore.open(root, demo.document, demo.audio)
    const path = join(root, "document.json")
    const state = JSON.parse(JSON.stringify(initialState(demo.document)))
    state.document.project.ucs_mode = "Single"
    state.document.project.chart.notes[0].panel_mask = 32
    state.library.charts[0].mode = "Single"
    state.library.charts[0].project = state.document.project
    await writeFile(path, `${JSON.stringify(state)}\n`)

    // When
    const reopened = StudioStore.open(root, demo.document, demo.audio)

    // Then
    await expect(reopened).rejects.toBeInstanceOf(Error)
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
