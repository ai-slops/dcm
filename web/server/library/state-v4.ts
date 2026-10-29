import { z } from "zod"

import { BeatSchema } from "../../shared/beat.ts"
import {
  BeatChartDocumentSchema,
  BeatCurrentDocumentSchema,
  BeatDocumentOriginSchema,
  BeatReusableComponentSchema,
  GenerationProjectV2Schema,
} from "../../shared/beat-projects.ts"
import {
  ChartIdSchema,
  LibraryArchiveSchema,
  LibraryRevisionSchema,
  LibrarySongSchema,
  MAX_LIBRARY_ARCHIVES,
  MAX_LIBRARY_CHARTS,
  MAX_LIBRARY_SONGS,
} from "../../shared/library.ts"
import { NonNegativeIntegerSchema } from "../../shared/native.ts"
import {
  GenerationProjectIdSchema,
  WorkspaceRevisionSchema,
} from "../../shared/project-identities.ts"

export const StoredBeatChartSchema = z
  .strictObject({
    id: ChartIdSchema,
    song_id: z.uuid().brand("SongId"),
    name: z.string().trim().min(1).max(160),
    mode: z.enum(["Single", "Double"]),
    note_count: NonNegativeIntegerSchema.max(100_000),
    hold_count: NonNegativeIntegerSchema.max(100_000),
    duration: BeatSchema.nullable(),
    chart_artist: z.string().trim().min(1).max(160).nullable(),
    project: BeatChartDocumentSchema,
    generated_from: BeatDocumentOriginSchema.optional(),
  })
  .superRefine((chart, context) => {
    const noteCount = chart.project.notes.reduce(
      (total, note) => total + countPanels(note.panel_mask),
      0,
    )
    const holdCount = chart.project.notes.reduce(
      (total, note) => total + (note.hold.numerator > 0 ? countPanels(note.panel_mask) : 0),
      0,
    )
    if (
      chart.mode !== chart.project.mode ||
      chart.note_count !== noteCount ||
      chart.hold_count !== holdCount ||
      chart.chart_artist !== chart.project.chart_artist ||
      JSON.stringify(chart.duration) !== JSON.stringify(chart.project.timing.duration)
    )
      context.addIssue({ code: "custom", message: "chart metadata differs from beat project" })
  })
  .readonly()

export const StoredBeatLibrarySchema = z
  .strictObject({
    revision: LibraryRevisionSchema,
    active_chart_id: ChartIdSchema,
    songs: z.array(LibrarySongSchema).min(1).max(MAX_LIBRARY_SONGS).readonly(),
    charts: z.array(StoredBeatChartSchema).min(1).max(MAX_LIBRARY_CHARTS).readonly(),
    archives: z.array(LibraryArchiveSchema).max(MAX_LIBRARY_ARCHIVES).readonly(),
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
      songsWithCharts.add(chart.song_id)
      if (!songIds.has(chart.song_id))
        context.addIssue({
          code: "custom",
          path: ["charts", index, "song_id"],
          message: "chart song is missing",
        })
      const song = library.songs.find((candidate) => candidate.id === chart.song_id)
      if (
        song !== undefined &&
        (chart.project.audio_sha256 !== song.audio.sha256 ||
          chart.project.audio_asset.format !== song.audio.format ||
          chart.project.audio_asset.byte_length !== song.audio.byte_length)
      )
        context.addIssue({
          code: "custom",
          path: ["charts", index, "project"],
          message: "chart audio binding differs from song",
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
        context.addIssue({
          code: "custom",
          path: ["songs", index],
          message: "song has no chart",
        })
  })
  .readonly()

export const PersistedBeatProjectsSchema = z
  .strictObject({
    revision: WorkspaceRevisionSchema,
    selected_project_id: GenerationProjectIdSchema.nullable(),
    records: z.array(GenerationProjectV2Schema).max(64).readonly(),
    components: z.array(BeatReusableComponentSchema).max(128).readonly(),
  })
  .readonly()

export const PersistedStateV4Schema = z
  .strictObject({
    version: z.literal(4),
    document: BeatCurrentDocumentSchema,
    library: StoredBeatLibrarySchema,
    projects: PersistedBeatProjectsSchema,
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
    if (
      active !== undefined &&
      JSON.stringify(active.generated_from) !== JSON.stringify(state.document.origin)
    )
      context.addIssue({
        code: "custom",
        path: ["document", "origin"],
        message: "document origin differs from active chart provenance",
      })
    const ids = new Set(state.projects.records.map((project) => project.id))
    if (state.projects.selected_project_id !== null && !ids.has(state.projects.selected_project_id))
      context.addIssue({
        code: "custom",
        path: ["projects", "selected_project_id"],
        message: "selected project is missing",
      })
  })
  .readonly()

export type BeatCurrentDocument = z.infer<typeof BeatCurrentDocumentSchema>
export type StoredBeatChart = z.infer<typeof StoredBeatChartSchema>
export type PersistedStateV4 = z.infer<typeof PersistedStateV4Schema>

export function beatChartSummary(project: z.infer<typeof BeatChartDocumentSchema>) {
  return {
    mode: project.mode,
    note_count: project.notes.reduce((total, note) => total + countPanels(note.panel_mask), 0),
    hold_count: project.notes.reduce(
      (total, note) => total + (note.hold.numerator > 0 ? countPanels(note.panel_mask) : 0),
      0,
    ),
    duration: project.timing.duration,
    chart_artist: project.chart_artist,
  }
}

function countPanels(mask: number): number {
  let value = mask
  let count = 0
  while (value !== 0) {
    count += value & 1
    value >>>= 1
  }
  return count
}
