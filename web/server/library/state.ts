import { randomUUID } from "node:crypto"

import type { z } from "zod"

import { normalizeChartDocument } from "../../shared/index.ts"
import {
  AudioBindingSchema,
  type ChartId,
  ChartIdSchema,
  SongIdSchema,
} from "../../shared/library.ts"
import { chartSummary, hexDigest } from "./chart-summary.ts"
import type { LegacyCurrentDocumentSchema, PersistedStateV3 } from "./legacy-state-schemas.ts"
import { PersistedStateV3Schema } from "./legacy-state-schemas.ts"

export {
  LegacyCurrentDocumentSchema,
  type PersistedStateV2,
  PersistedStateV2Schema,
  type PersistedStateV3,
  PersistedStateV3Schema,
  type StoredArchive,
  StoredArchiveSchema,
  type StoredChart,
  StoredChartSchema,
  type StoredLibrary,
  StoredLibrarySchema,
} from "./legacy-state-schemas.ts"

export function initialState(
  document: z.infer<typeof LegacyCurrentDocumentSchema>,
): PersistedStateV3 {
  const canonicalDocument = {
    ...document,
    project: normalizeChartDocument(document.project),
  }
  const songId = SongIdSchema.parse(randomUUID())
  const chartId = ChartIdSchema.parse(randomUUID())
  const audio = AudioBindingSchema.parse({
    ...canonicalDocument.project.audio_asset,
    sha256: hexDigest(canonicalDocument.project.music.audio_sha256),
  })
  return PersistedStateV3Schema.parse({
    version: 3,
    document: canonicalDocument,
    library: {
      revision: 0,
      active_chart_id: chartId,
      songs: [
        {
          id: songId,
          title: canonicalDocument.project.title,
          artist: canonicalDocument.project.artist,
          audio,
        },
      ],
      charts: [
        {
          id: chartId,
          song_id: songId,
          name: "Main",
          mode: canonicalDocument.project.ucs_mode,
          ...chartSummary(canonicalDocument.project),
          project: canonicalDocument.project,
        },
      ],
      archives: [],
    },
    projects: { revision: 0, selected_project_id: null, records: [], components: [] },
  })
}

export function snapshot(state: PersistedStateV3) {
  return {
    ...state.library,
    charts: state.library.charts.map(({ project: _project, ...chart }) => chart),
  }
}

export function chartDocument(state: PersistedStateV3, id: ChartId) {
  const stored = state.library.charts.find((chart) => chart.id === id)
  if (stored === undefined) return undefined
  const song = state.library.songs.find((candidate) => candidate.id === stored.song_id)
  if (song === undefined) return undefined
  const { project, ...chart } = stored
  return { chart, song, project }
}
