import type { BeatChartDocument } from "../../shared/beat-projects.ts"
import { RevisionSchema } from "../../shared/index.ts"
import {
  type ChartId,
  type LibraryMutation,
  LibraryMutationSchema,
  LibraryRevisionSchema,
  type SongId,
} from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import { beatChartSummary, type PersistedStateV4 } from "./state-v4.ts"

export function storedChart(id: ChartId, songId: SongId, name: string, project: BeatChartDocument) {
  return { id, song_id: songId, name, ...beatChartSummary(project), project }
}

export function switchActive(
  state: PersistedStateV4,
  chart: PersistedStateV4["library"]["charts"][number],
) {
  return {
    ...state,
    document: {
      revision: RevisionSchema.parse(state.document.revision + 1),
      project: chart.project,
      ...(chart.generated_from === undefined ? {} : { origin: chart.generated_from }),
    },
    library: {
      ...state.library,
      revision: LibraryRevisionSchema.parse(state.library.revision + 1),
      active_chart_id: chart.id,
    },
  }
}

export function bumpLibrary(
  state: PersistedStateV4,
  changes: Partial<PersistedStateV4["library"]>,
) {
  return {
    ...state,
    library: {
      ...state.library,
      ...changes,
      revision: LibraryRevisionSchema.parse(state.library.revision + 1),
    },
  }
}

export function mutation(state: PersistedStateV4): LibraryMutation {
  return LibraryMutationSchema.parse({
    document: state.document,
    library: {
      ...state.library,
      charts: state.library.charts.map(({ project: _project, ...chart }) => chart),
    },
  })
}

export function expectRevision(state: PersistedStateV4, revision: number): void {
  if (state.document.revision !== revision)
    throw new StudioError(
      409,
      "revision_conflict",
      "Document revision is stale",
      state.document.revision,
    )
}

export function requireChart(state: PersistedStateV4, id: ChartId) {
  const chart = state.library.charts.find((candidate) => candidate.id === id)
  if (chart === undefined) throw new StudioError(404, "chart_not_found", "Chart was not found")
  return chart
}

export function requireSong(state: PersistedStateV4, id: SongId) {
  const song = state.library.songs.find((candidate) => candidate.id === id)
  if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
  return song
}

export function requireFallback(
  state: PersistedStateV4,
  id: ChartId | undefined,
  deleted: ChartId,
) {
  if (id === undefined)
    throw new StudioError(
      409,
      "fallback_required",
      "Choose another chart before deleting the active chart",
    )
  if (id === deleted)
    throw new StudioError(409, "fallback_invalid", "Fallback chart is being deleted")
  return requireChart(state, id)
}

export function requireFallbackSet(
  state: PersistedStateV4,
  id: ChartId | undefined,
  deleted: ReadonlySet<ChartId>,
) {
  if (id === undefined)
    throw new StudioError(
      409,
      "fallback_required",
      "Choose another chart before deleting the active song",
    )
  if (deleted.has(id))
    throw new StudioError(409, "fallback_invalid", "Fallback chart belongs to the deleted song")
  return requireChart(state, id)
}
