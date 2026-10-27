import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  type CurrentDocument,
  CurrentDocumentSchema,
  StudioProjectV1Schema,
} from "../../shared/index.ts"
import {
  AudioBindingSchema,
  type ChartId,
  ChartIdSchema,
  LibraryArchiveSchema,
  type LibraryChartDocument,
  LibraryChartSchema,
  LibraryRevisionSchema,
  type LibrarySnapshot,
  LibrarySnapshotSchema,
  LibrarySongSchema,
  MAX_LIBRARY_ARCHIVES,
  MAX_LIBRARY_CHARTS,
  MAX_LIBRARY_SONGS,
  SongIdSchema,
} from "../../shared/library.ts"

export const StoredChartSchema = LibraryChartSchema.unwrap()
  .extend({ project: StudioProjectV1Schema })
  .readonly()
export const StoredArchiveSchema = LibraryArchiveSchema
export const StoredLibrarySchema = z
  .strictObject({
    revision: LibraryRevisionSchema,
    active_chart_id: ChartIdSchema,
    songs: z.array(LibrarySongSchema).min(1).max(MAX_LIBRARY_SONGS).readonly(),
    charts: z.array(StoredChartSchema).min(1).max(MAX_LIBRARY_CHARTS).readonly(),
    archives: z.array(StoredArchiveSchema).max(MAX_LIBRARY_ARCHIVES).readonly(),
  })
  .superRefine((library, context) => {
    const archiveIds = new Set<string>()
    for (const [index, archive] of library.archives.entries()) {
      if (archiveIds.has(archive.id))
        context.addIssue({
          code: "custom",
          path: ["archives", index, "id"],
          message: "duplicate archive ID",
        })
      archiveIds.add(archive.id)
    }
    const songIds = new Set<string>()
    for (const [index, song] of library.songs.entries()) {
      if (songIds.has(song.id))
        context.addIssue({
          code: "custom",
          path: ["songs", index, "id"],
          message: "duplicate song ID",
        })
      songIds.add(song.id)
      if (song.archive_id !== undefined && !archiveIds.has(song.archive_id))
        context.addIssue({
          code: "custom",
          path: ["songs", index, "archive_id"],
          message: "song archive is missing",
        })
    }
    const chartIds = new Set<string>()
    const songsWithCharts = new Set<string>()
    for (const [index, chart] of library.charts.entries()) {
      if (chartIds.has(chart.id))
        context.addIssue({
          code: "custom",
          path: ["charts", index, "id"],
          message: "duplicate chart ID",
        })
      chartIds.add(chart.id)
      if (!songIds.has(chart.song_id))
        context.addIssue({
          code: "custom",
          path: ["charts", index, "song_id"],
          message: "chart song is missing",
        })
      songsWithCharts.add(chart.song_id)
      const song = library.songs.find((candidate) => candidate.id === chart.song_id)
      if (
        song !== undefined &&
        (hexDigest(chart.project.music.audio_sha256) !== song.audio.sha256 ||
          chart.project.audio_asset.format !== song.audio.format ||
          chart.project.audio_asset.byte_length !== song.audio.byte_length)
      )
        context.addIssue({
          code: "custom",
          path: ["charts", index, "project"],
          message: "chart audio binding differs from song",
        })
      const summary = chartSummary(chart.project)
      if (
        chart.mode !== (chart.project.ucs_mode ?? "Double") ||
        chart.note_count !== summary.note_count ||
        chart.hold_count !== summary.hold_count ||
        chart.ticks_per_beat !== summary.ticks_per_beat ||
        chart.duration_ticks !== summary.duration_ticks
      )
        context.addIssue({
          code: "custom",
          path: ["charts", index],
          message: "chart metadata differs from project",
        })
    }
    if (!chartIds.has(library.active_chart_id))
      context.addIssue({
        code: "custom",
        path: ["active_chart_id"],
        message: "active chart is missing",
      })
    for (const [index, song] of library.songs.entries())
      if (!songsWithCharts.has(song.id))
        context.addIssue({ code: "custom", path: ["songs", index], message: "song has no chart" })
  })
  .readonly()

export const PersistedStateV2Schema = z
  .strictObject({
    version: z.literal(2),
    document: CurrentDocumentSchema,
    library: StoredLibrarySchema,
  })
  .superRefine((state, context) => {
    const active = state.library.charts.find((chart) => chart.id === state.library.active_chart_id)
    if (
      active !== undefined &&
      JSON.stringify(active.project) !== JSON.stringify(state.document.project)
    )
      context.addIssue({
        code: "custom",
        path: ["document", "project"],
        message: "document differs from active chart",
      })
  })
  .readonly()

export type StoredChart = z.infer<typeof StoredChartSchema>
export type StoredArchive = z.infer<typeof StoredArchiveSchema>
export type StoredLibrary = z.infer<typeof StoredLibrarySchema>
export type PersistedStateV2 = z.infer<typeof PersistedStateV2Schema>

export function initialState(document: CurrentDocument): PersistedStateV2 {
  const songId = SongIdSchema.parse(randomUUID())
  const chartId = ChartIdSchema.parse(randomUUID())
  const audio = AudioBindingSchema.parse({
    ...document.project.audio_asset,
    sha256: hexDigest(document.project.music.audio_sha256),
  })
  return PersistedStateV2Schema.parse({
    version: 2,
    document,
    library: {
      revision: 0,
      active_chart_id: chartId,
      songs: [
        { id: songId, title: document.project.title, artist: document.project.artist, audio },
      ],
      charts: [
        {
          id: chartId,
          song_id: songId,
          name: "Main",
          mode: document.project.ucs_mode ?? "Double",
          ...chartSummary(document.project),
          project: document.project,
        },
      ],
      archives: [],
    },
  })
}

export function snapshot(state: PersistedStateV2): LibrarySnapshot {
  return LibrarySnapshotSchema.parse({
    ...state.library,
    charts: state.library.charts.map(({ project: _project, ...chart }) => chart),
  })
}

export function chartDocument(
  state: PersistedStateV2,
  id: ChartId,
): LibraryChartDocument | undefined {
  const stored = state.library.charts.find((chart) => chart.id === id)
  if (stored === undefined) return undefined
  const song = state.library.songs.find((candidate) => candidate.id === stored.song_id)
  if (song === undefined) return undefined
  const { project, ...chart } = stored
  return { chart, song, project }
}

export function chartSummary(project: z.infer<typeof StudioProjectV1Schema>) {
  return {
    note_count: project.chart.notes.reduce((total, note) => total + bitCount(note.panel_mask), 0),
    hold_count: project.chart.notes.reduce(
      (total, note) => total + (note.hold_ticks > 0 ? bitCount(note.panel_mask) : 0),
      0,
    ),
    ticks_per_beat: project.chart.ticks_per_beat,
    duration_ticks: project.chart.span_ticks,
  }
}

export function hexDigest(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function bitCount(value: number): number {
  let remaining = value
  let count = 0
  while (remaining !== 0) {
    count += remaining & 1
    remaining >>>= 1
  }
  return count
}
