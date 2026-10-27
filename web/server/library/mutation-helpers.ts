import { RevisionSchema, type StudioProjectV1Schema, type UcsMode } from "../../shared/index.ts"
import {
  type ChartId,
  type LibraryMutation,
  LibraryMutationSchema,
  LibraryRevisionSchema,
  type SongId,
} from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import { chartSummary, type PersistedStateV3, snapshot } from "./state.ts"

export function storedChart(
  id: ChartId,
  songId: SongId,
  name: string,
  mode: UcsMode,
  project: ReturnType<typeof StudioProjectV1Schema.parse>,
) {
  return { id, song_id: songId, name, mode, ...chartSummary(project), project }
}

export function switchActive(
  state: PersistedStateV3,
  chart: PersistedStateV3["library"]["charts"][number],
) {
  return {
    ...state,
    document: {
      revision: RevisionSchema.parse(state.document.revision + 1),
      project: chart.project,
    },
    library: {
      ...state.library,
      revision: LibraryRevisionSchema.parse(state.library.revision + 1),
      active_chart_id: chart.id,
    },
  }
}

export function bumpLibrary(
  state: PersistedStateV3,
  changes: Partial<PersistedStateV3["library"]>,
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

export function mutation(state: PersistedStateV3): LibraryMutation {
  return LibraryMutationSchema.parse({ document: state.document, library: snapshot(state) })
}

export function expectRevision(state: PersistedStateV3, revision: number): void {
  if (state.document.revision !== revision)
    throw new StudioError(
      409,
      "revision_conflict",
      "Document revision is stale",
      state.document.revision,
    )
}

export function requireChart(state: PersistedStateV3, id: ChartId) {
  const chart = state.library.charts.find((candidate) => candidate.id === id)
  if (chart === undefined) throw new StudioError(404, "chart_not_found", "Chart was not found")
  return chart
}

export function requireSong(state: PersistedStateV3, id: SongId) {
  const song = state.library.songs.find((candidate) => candidate.id === id)
  if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
  return song
}

export function requireFallback(
  state: PersistedStateV3,
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
  state: PersistedStateV3,
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
