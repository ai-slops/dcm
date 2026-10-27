import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { RevisionSchema } from "../shared/index.ts"
import { LibrarySnapshotSchema, SongIdSchema } from "../shared/library.ts"
import {
  acceptMonotonicLibrarySnapshot,
  audioInputAtRevisions,
  fallbackChartId,
  guardedSwitchDocument,
  libraryCloseEffect,
  libraryCommandAtRevisions,
  libraryDialogSurface,
  libraryDocumentEffect,
  newSongAtRevisions,
  reconcileSelectedSongId,
  songCharts,
} from "../src/ui/library-workflow.ts"
import { repoRoot } from "./support/paths.ts"

const firstSongId = SongIdSchema.parse("11111111-1111-4111-8111-111111111111")
const secondSongId = "22222222-2222-4222-8222-222222222222"
const activeChartId = "33333333-3333-4333-8333-333333333333"
const fallbackId = "44444444-4444-4444-8444-444444444444"

const snapshot = LibrarySnapshotSchema.parse({
  revision: 3,
  active_chart_id: activeChartId,
  songs: [
    {
      id: firstSongId,
      title: "First",
      artist: "Artist",
      audio: { format: "wav", byte_length: 44, sha256: "a".repeat(64) },
    },
    {
      id: secondSongId,
      title: "Second",
      artist: "Artist",
      audio: { format: "mp3", byte_length: 128, sha256: "b".repeat(64) },
    },
  ],
  charts: [
    {
      id: activeChartId,
      song_id: firstSongId,
      name: "Active",
      mode: "Double",
      note_count: 8,
      hold_count: 1,
      ticks_per_beat: 4,
      duration_ticks: 32,
    },
    {
      id: fallbackId,
      song_id: secondSongId,
      name: "Fallback",
      mode: "Single",
      note_count: 4,
      hold_count: 0,
      ticks_per_beat: 4,
      duration_ticks: 32,
    },
  ],
  archives: [],
})

describe("library workflow helpers", () => {
  it("groups charts under their owning song", () => {
    // Given / When
    const charts = songCharts(snapshot, snapshot.songs[0]?.id)

    // Then
    expect(charts.map((chart) => chart.name)).toEqual(["Active"])
  })

  it("chooses a surviving chart when deleting the active song", () => {
    // Given / When
    const result = fallbackChartId(snapshot, firstSongId)

    // Then
    expect(result).toBe(fallbackId)
  })

  it("preserves the browser draft for library-only revision drift", () => {
    // Given / When / Then
    expect(libraryDocumentEffect("library_only", 7, 7)).toBe("preserve")
    expect(libraryDocumentEffect("library_only", 7, 8)).toBe("stale")
  })

  it("accepts the server document for an explicit document switch", () => {
    // Given / When / Then
    expect(libraryDocumentEffect("replace_document", 7, 7)).toBe("accept")
    expect(libraryDocumentEffect("replace_document", 7, 8)).toBe("accept")
  })

  it("replaces captured revisions after save before switching charts", () => {
    // Given
    const command = {
      type: "open_chart" as const,
      library_revision: snapshot.revision,
      base_revision: RevisionSchema.parse(5),
      chart_id: snapshot.active_chart_id,
    }

    // When
    const refreshed = libraryCommandAtRevisions(command, {
      documentRevision: RevisionSchema.parse(6),
      libraryRevision: LibrarySnapshotSchema.parse({ ...snapshot, revision: 4 }).revision,
    })

    // Then
    if (refreshed.type !== "open_chart") throw new TypeError("Expected open chart command")
    expect(refreshed.base_revision).toBe(6)
    expect(refreshed.library_revision).toBe(4)
  })

  it("replaces captured revisions after save for new-song and audio writes", () => {
    // Given
    const revisions = {
      documentRevision: RevisionSchema.parse(6),
      libraryRevision: LibrarySnapshotSchema.parse({ ...snapshot, revision: 4 }).revision,
    }
    const newSong = {
      library_revision: snapshot.revision,
      base_revision: RevisionSchema.parse(5),
      title: "Fresh song",
      artist: "Artist",
      chart_name: "Blank",
      mode: "Double" as const,
      bpm: 138,
      beats: 128,
    }

    // When
    const refreshedSong = newSongAtRevisions(newSong, revisions)
    const refreshedAudio = audioInputAtRevisions(revisions)

    // Then
    expect(refreshedSong).toMatchObject({ library_revision: 4, base_revision: 6 })
    expect(refreshedAudio).toEqual({ library_revision: 4, base_revision: 6 })
  })

  it("rejects a stale GET snapshot after a newer mutation snapshot", () => {
    // Given
    const newer = LibrarySnapshotSchema.parse({ ...snapshot, revision: 4 })

    // When / Then
    expect(acceptMonotonicLibrarySnapshot(newer, snapshot)).toBe(newer)
    expect(acceptMonotonicLibrarySnapshot(snapshot, newer)).toBe(newer)
  })

  it("reconciles selection after deletion and prefers the active song after replacement", () => {
    // Given
    const activeFallback = LibrarySnapshotSchema.parse({
      ...snapshot,
      active_chart_id: fallbackId,
      songs: snapshot.songs.filter((song) => song.id !== firstSongId),
      charts: snapshot.charts.filter((chart) => chart.song_id !== firstSongId),
    })

    // When / Then
    expect(reconcileSelectedSongId(activeFallback, firstSongId, "retain")).toBe(secondSongId)
    expect(reconcileSelectedSongId(activeFallback, firstSongId, "prefer_active")).toBe(secondSongId)
    const activeChanged = LibrarySnapshotSchema.parse({ ...snapshot, active_chart_id: fallbackId })
    expect(reconcileSelectedSongId(activeChanged, firstSongId, "retain")).toBe(firstSongId)
    expect(reconcileSelectedSongId(activeChanged, firstSongId, "prefer_active")).toBe(secondSongId)
  })

  it("clears a pending action before closing the library dialog", () => {
    // Given / When / Then
    expect(libraryCloseEffect(true)).toBe("clear_pending")
    expect(libraryCloseEffect(false)).toBe("close_dialog")
  })

  it("replaces long library content with the pending guard", () => {
    // Given / When / Then
    expect(libraryDialogSurface(true, false, true)).toBe("guard")
    expect(libraryDialogSurface(false, true, true)).toBe("loading")
    expect(libraryDialogSurface(false, false, true)).toBe("content")
  })

  it("aborts a guarded switch when save persisted an older draft", async () => {
    // Given
    const demo = await loadDemo(repoRoot)

    // When / Then
    expect(guardedSwitchDocument({ kind: "saved_older", document: demo.document })).toBeNull()
    expect(guardedSwitchDocument({ kind: "saved_current", document: demo.document })).toEqual(
      demo.document,
    )
  })
})
