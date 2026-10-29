import { z } from "zod"

import { CurrentDocumentSchema } from "./api.ts"
import { BeatSchema, BeatTimingSchema } from "./beat.ts"
import { BeatChartDocumentSchema, BeatDocumentOriginSchema } from "./beat-projects.ts"
import { NonNegativeIntegerSchema } from "./native.ts"
import { AudioAssetSchema, UcsModeSchema } from "./project.ts"

export const MAX_LIBRARY_SONGS = 64
export const MAX_LIBRARY_CHARTS = 128
export const MAX_LIBRARY_ARCHIVES = 32
export const SongIdSchema = z.uuid().brand("SongId")
export const ChartIdSchema = z.uuid().brand("ChartId")
export const ArchiveIdSchema = z.uuid().brand("ArchiveId")
export const LibraryRevisionSchema = NonNegativeIntegerSchema.brand("LibraryRevision")
export const LibraryLabelSchema = z.string().trim().min(1).max(160)
export const AudioBindingSchema = AudioAssetSchema.unwrap()
  .extend({ sha256: z.string().regex(/^[0-9a-f]{64}$/) })
  .readonly()
export const ArchiveSourceTimingSchema = z
  .strictObject({
    chart_name: z.string().min(1).max(512),
    audio_name: z.string().min(1).max(512),
    mode: UcsModeSchema,
    timing: BeatTimingSchema,
  })
  .readonly()

export const LibrarySongSchema = z
  .strictObject({
    id: SongIdSchema,
    title: LibraryLabelSchema,
    artist: LibraryLabelSchema,
    audio: AudioBindingSchema,
    archive_id: ArchiveIdSchema.optional(),
    archive_source: ArchiveSourceTimingSchema.optional(),
  })
  .readonly()

export const LibraryChartSchema = z
  .strictObject({
    id: ChartIdSchema,
    song_id: SongIdSchema,
    name: LibraryLabelSchema,
    mode: UcsModeSchema,
    note_count: NonNegativeIntegerSchema.max(100_000),
    hold_count: NonNegativeIntegerSchema.max(100_000),
    duration: BeatSchema.nullable(),
    chart_artist: LibraryLabelSchema.nullable(),
    generated_from: BeatDocumentOriginSchema.optional(),
  })
  .readonly()

export const LibraryArchiveSchema = z
  .strictObject({
    id: ArchiveIdSchema,
    name: LibraryLabelSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byte_length: NonNegativeIntegerSchema.max(64 * 1024 * 1024),
    source_url: z.url().optional(),
    title: LibraryLabelSchema.optional(),
    artist: LibraryLabelSchema.optional(),
    chart_names: z.array(z.string().min(1).max(512)).max(32).readonly(),
    audio_names: z.array(z.string().min(1).max(512)).max(32).readonly(),
  })
  .readonly()

export const LibrarySnapshotSchema = z
  .strictObject({
    revision: LibraryRevisionSchema,
    active_chart_id: ChartIdSchema,
    songs: z.array(LibrarySongSchema).max(MAX_LIBRARY_SONGS).readonly(),
    charts: z.array(LibraryChartSchema).max(MAX_LIBRARY_CHARTS).readonly(),
    archives: z.array(LibraryArchiveSchema).max(MAX_LIBRARY_ARCHIVES).readonly(),
  })
  .readonly()

export const LibraryMutationSchema = z
  .strictObject({
    document: CurrentDocumentSchema,
    library: LibrarySnapshotSchema,
  })
  .readonly()

export const LibraryChartDocumentSchema = z
  .strictObject({
    chart: LibraryChartSchema,
    song: LibrarySongSchema,
    project: BeatChartDocumentSchema,
  })
  .readonly()

export const UcsCatalogItemSchema = z
  .strictObject({
    code: z.string().regex(/^CS[0-9]{3,4}$/),
    title: LibraryLabelSchema,
    artist: LibraryLabelSchema,
    bpm: z.string().min(1).max(64),
  })
  .readonly()

export const UcsCatalogResultSchema = z
  .strictObject({
    query: z.string().min(1).max(100),
    count: NonNegativeIntegerSchema,
    items: z.array(UcsCatalogItemSchema).max(100).readonly(),
    source_url: z.url(),
  })
  .readonly()

export type SongId = z.infer<typeof SongIdSchema>
export type ChartId = z.infer<typeof ChartIdSchema>
export type ArchiveId = z.infer<typeof ArchiveIdSchema>
export type LibraryRevision = z.infer<typeof LibraryRevisionSchema>
export type AudioBinding = z.infer<typeof AudioBindingSchema>
export type ArchiveSourceTiming = z.infer<typeof ArchiveSourceTimingSchema>
export type LibrarySong = z.infer<typeof LibrarySongSchema>
export type LibraryChart = z.infer<typeof LibraryChartSchema>
export type LibraryArchive = z.infer<typeof LibraryArchiveSchema>
export type LibrarySnapshot = z.infer<typeof LibrarySnapshotSchema>
export type LibraryMutation = z.infer<typeof LibraryMutationSchema>
export type LibraryChartDocument = z.infer<typeof LibraryChartDocumentSchema>
export type UcsCatalogItem = z.infer<typeof UcsCatalogItemSchema>
export type UcsCatalogResult = z.infer<typeof UcsCatalogResultSchema>
