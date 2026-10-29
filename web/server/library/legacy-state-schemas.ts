import { z } from "zod"

import {
  ChartDocumentSchema,
  NonNegativeIntegerSchema,
  RevisionSchema,
  StudioProjectV1Schema,
} from "../../shared/index.ts"
import {
  AudioBindingSchema,
  ChartIdSchema,
  LibraryArchiveSchema,
  LibraryRevisionSchema,
  MAX_LIBRARY_ARCHIVES,
  MAX_LIBRARY_CHARTS,
  MAX_LIBRARY_SONGS,
  SongIdSchema,
} from "../../shared/library.ts"
import { chartSummary, hexDigest } from "./chart-summary.ts"
import { PersistedProjectsSchema } from "./project-collection.ts"

const LegacyLibraryChartSchema = z
  .strictObject({
    id: ChartIdSchema,
    song_id: SongIdSchema,
    name: z.string().trim().min(1).max(160),
    mode: z.enum(["Single", "Double"]),
    note_count: NonNegativeIntegerSchema.max(100_000),
    hold_count: NonNegativeIntegerSchema.max(100_000),
    ticks_per_beat: z.number().int().positive().max(4_096),
    duration_ticks: z.number().int().positive().max(1_000_000),
    generated_from: z
      .strictObject({
        project_id: z.uuid().brand("GenerationProjectId"),
        project_revision: NonNegativeIntegerSchema,
        seed: z.string().regex(/^[0-9a-f]{64}$/),
        automatic_regions: z
          .array(
            z
              .strictObject({
                id: z.uuid().brand("HybridRegionId"),
                name: z.string().trim().min(1).max(80),
                start_tick: NonNegativeIntegerSchema,
                end_tick: NonNegativeIntegerSchema,
              })
              .readonly(),
          )
          .max(64)
          .readonly()
          .optional(),
      })
      .readonly()
      .optional(),
  })
  .readonly()

export const StoredChartSchema = LegacyLibraryChartSchema.unwrap()
  .extend({ project: StudioProjectV1Schema })
  .readonly()
export const StoredArchiveSchema = LibraryArchiveSchema

const LegacyArchiveTimingSchema = z
  .strictObject({
    duration_ticks: z.number().int().positive().max(1_000_000),
    ticks_per_beat: z.number().int().positive().max(4_096),
    offset_micros: z.number().int().safe(),
    tempo: z
      .array(
        z
          .strictObject({
            start_tick: NonNegativeIntegerSchema,
            micros_per_beat: z
              .strictObject({
                numerator: z.number().int().positive().safe(),
                denominator: z.number().int().positive().safe(),
              })
              .readonly(),
          })
          .readonly(),
      )
      .min(1)
      .max(4_096)
      .readonly(),
    reference_accents: z.array(NonNegativeIntegerSchema).max(10_000).readonly(),
  })
  .readonly()

const LegacyLibrarySongSchema = z
  .strictObject({
    id: SongIdSchema,
    title: z.string().trim().min(1).max(160),
    artist: z.string().trim().min(1).max(160),
    audio: AudioBindingSchema,
    archive_id: z.uuid().brand("ArchiveId").optional(),
    archive_source: z
      .strictObject({
        chart_name: z.string().min(1).max(512),
        audio_name: z.string().min(1).max(512),
        mode: z.enum(["Single", "Double"]),
        timing: LegacyArchiveTimingSchema,
      })
      .readonly()
      .optional(),
  })
  .readonly()

export const LegacyCurrentDocumentSchema = z
  .strictObject({ revision: RevisionSchema, project: StudioProjectV1Schema })
  .readonly()

export const StoredLibrarySchema = z
  .strictObject({
    revision: LibraryRevisionSchema,
    active_chart_id: ChartIdSchema,
    songs: z.array(LegacyLibrarySongSchema).min(1).max(MAX_LIBRARY_SONGS).readonly(),
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
        context.addIssue({
          code: "custom",
          path: ["songs", index],
          message: "song has no chart",
        })
  })
  .readonly()

export const PersistedStateV2Schema = z
  .strictObject({
    version: z.literal(2),
    document: LegacyCurrentDocumentSchema,
    library: StoredLibrarySchema,
  })
  .superRefine(validateDocumentMatchesActive)
  .readonly()

export const PersistedStateV3Schema = z
  .strictObject({
    version: z.literal(3),
    document: LegacyCurrentDocumentSchema,
    library: StoredLibrarySchema,
    projects: PersistedProjectsSchema,
  })
  .superRefine((state, context) => {
    validateDocumentMatchesActive(state, context)
    for (const [index, chart] of state.library.charts.entries())
      if (!ChartDocumentSchema.safeParse(chart.project).success)
        context.addIssue({
          code: "custom",
          path: ["library", "charts", index, "project"],
          message: "stored chart is not canonical",
        })
  })
  .readonly()

export type StoredChart = z.infer<typeof StoredChartSchema>
export type StoredArchive = z.infer<typeof StoredArchiveSchema>
export type StoredLibrary = z.infer<typeof StoredLibrarySchema>
export type PersistedStateV2 = z.infer<typeof PersistedStateV2Schema>
export type PersistedStateV3 = z.infer<typeof PersistedStateV3Schema>

function validateDocumentMatchesActive(
  state: {
    readonly document: z.infer<typeof LegacyCurrentDocumentSchema>
    readonly library: z.infer<typeof StoredLibrarySchema>
  },
  context: z.RefinementCtx,
): void {
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
}
