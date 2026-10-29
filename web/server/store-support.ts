import { createHash, randomUUID } from "node:crypto"

import type { BeatCurrentDocument } from "../shared/beat-projects.ts"
import { ChartIdSchema, SongIdSchema } from "../shared/library.ts"
import { StudioError } from "./errors.ts"
import type { AssetWrite } from "./library/assets.ts"
import { hexDigest } from "./library/chart-summary.ts"
import {
  beatChartSummary,
  type PersistedStateV4,
  PersistedStateV4Schema,
} from "./library/state-v4.ts"

export type AudioRecord = {
  readonly bytes: Uint8Array
  readonly digest: string
  readonly format: "wav" | "ogg" | "mp3"
}

export function activeChart(state: PersistedStateV4) {
  const chart = state.library.charts.find(
    (candidate) => candidate.id === state.library.active_chart_id,
  )
  if (chart === undefined) throw new StudioError(500, "library_corrupt", "Active chart is missing")
  return chart
}

export function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return {
    bytes: Uint8Array.from(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
    format,
  }
}

export function audioWrite(audio: AudioRecord): AssetWrite {
  return { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes }
}

export function assertAudio(
  project: {
    readonly audio_sha256: string
    readonly audio_asset: { readonly format: AudioRecord["format"]; readonly byte_length: number }
  },
  audio: AudioRecord,
): void {
  if (
    audio.digest !== project.audio_sha256 ||
    audio.bytes.byteLength !== project.audio_asset.byte_length
  )
    throw new StudioError(500, "audio_corrupt", "Audio bytes differ from project metadata")
}

export function assertLegacyAudio(
  project: {
    readonly music: { readonly audio_sha256: readonly number[] }
    readonly audio_asset: { readonly byte_length: number }
  },
  audio: AudioRecord,
): void {
  if (
    audio.digest !== hexDigest(project.music.audio_sha256) ||
    audio.bytes.byteLength !== project.audio_asset.byte_length
  )
    throw new StudioError(500, "audio_corrupt", "Audio bytes differ from project metadata")
}

export function initialBeatState(document: BeatCurrentDocument): PersistedStateV4 {
  const songId = SongIdSchema.parse(randomUUID())
  const chartId = ChartIdSchema.parse(randomUUID())
  const audio = {
    ...document.project.audio_asset,
    sha256: document.project.audio_sha256,
  }
  return PersistedStateV4Schema.parse({
    version: 4,
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
          ...beatChartSummary(document.project),
          project: document.project,
        },
      ],
      archives: [],
    },
    projects: { revision: 0, selected_project_id: null, records: [], components: [] },
  })
}

export function cloneAudio(audio: AudioRecord): AudioRecord {
  return { ...audio, bytes: Uint8Array.from(audio.bytes) }
}
