import { z } from "zod"

import { RevisionSchema } from "./api.ts"
import {
  ArchiveIdSchema,
  ChartIdSchema,
  LibraryLabelSchema,
  LibraryRevisionSchema,
  SongIdSchema,
} from "./library.ts"
import { UcsModeSchema } from "./project.ts"

const base = { library_revision: LibraryRevisionSchema } as const
const switchBase = { ...base, base_revision: RevisionSchema } as const

export const NewSongSchema = z
  .strictObject({
    ...switchBase,
    title: LibraryLabelSchema,
    artist: LibraryLabelSchema,
    chart_name: LibraryLabelSchema,
    mode: UcsModeSchema,
    bpm: z.number().finite().positive().max(1_000),
    beats: z.number().int().positive().max(20_000),
  })
  .readonly()

export const ImportChartSchema = z
  .strictObject({
    ...base,
    name: LibraryLabelSchema,
  })
  .readonly()

export const LibraryCommandSchema = z.discriminatedUnion("type", [
  z
    .strictObject({ type: z.literal("open_chart"), ...switchBase, chart_id: ChartIdSchema })
    .readonly(),
  z
    .strictObject({
      type: z.literal("new_chart"),
      ...switchBase,
      song_id: SongIdSchema,
      name: LibraryLabelSchema,
      mode: UcsModeSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("duplicate_chart"),
      ...base,
      chart_id: ChartIdSchema,
      name: LibraryLabelSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("rename_chart"),
      ...base,
      chart_id: ChartIdSchema,
      name: LibraryLabelSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("rename_song"),
      ...base,
      song_id: SongIdSchema,
      title: LibraryLabelSchema,
      artist: LibraryLabelSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("delete_chart"),
      ...base,
      chart_id: ChartIdSchema,
      base_revision: RevisionSchema.optional(),
      fallback_chart_id: ChartIdSchema.optional(),
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("delete_song"),
      ...base,
      song_id: SongIdSchema,
      base_revision: RevisionSchema.optional(),
      fallback_chart_id: ChartIdSchema.optional(),
    })
    .readonly(),
  z
    .strictObject({ type: z.literal("delete_archive"), ...base, archive_id: ArchiveIdSchema })
    .readonly(),
  z
    .strictObject({
      type: z.literal("import_archive"),
      ...base,
      archive_id: ArchiveIdSchema,
      audio_name: z.string().min(1).max(512),
      chart_names: z.array(z.string().min(1).max(512)).min(1).max(32).readonly(),
      title: LibraryLabelSchema,
      artist: LibraryLabelSchema,
    })
    .readonly(),
])

export const DownloadArchiveSchema = z
  .strictObject({
    ...base,
    code: z
      .string()
      .trim()
      .regex(/^CS[0-9]{3,4}$/i),
  })
  .readonly()

export type NewSong = z.infer<typeof NewSongSchema>
export type ImportChart = z.infer<typeof ImportChartSchema>
export type LibraryCommand = z.infer<typeof LibraryCommandSchema>
export type DownloadArchive = z.infer<typeof DownloadArchiveSchema>
