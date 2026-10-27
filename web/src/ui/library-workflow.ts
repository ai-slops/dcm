import type { CurrentDocument, Revision } from "../../shared/index.ts"
import type {
  ChartId,
  LibraryChart,
  LibraryRevision,
  LibrarySnapshot,
  SongId,
} from "../../shared/library.ts"
import type { LibraryCommand, NewSong } from "../../shared/library-commands.ts"
import type { SaveResult } from "./studio-types.ts"

export function songCharts(
  library: LibrarySnapshot,
  songId: SongId | undefined,
): readonly LibraryChart[] {
  if (songId === undefined) return []
  return library.charts.filter((chart) => chart.song_id === songId)
}

export function fallbackChartId(
  library: LibrarySnapshot,
  excludedSongId?: SongId,
  excludedChartId?: ChartId,
): ChartId | undefined {
  return library.charts.find(
    (chart) => chart.song_id !== excludedSongId && chart.id !== excludedChartId,
  )?.id
}

export function acceptMonotonicLibrarySnapshot(
  current: LibrarySnapshot | null,
  incoming: LibrarySnapshot,
): LibrarySnapshot {
  return current !== null && current.revision > incoming.revision ? current : incoming
}

export type LibrarySelectionPreference = "prefer_active" | "retain"

export function reconcileSelectedSongId(
  library: LibrarySnapshot,
  selectedSongId: SongId | undefined,
  preference: LibrarySelectionPreference,
): SongId | undefined {
  const activeSongId = library.charts.find((chart) => chart.id === library.active_chart_id)?.song_id
  if (preference === "prefer_active") return activeSongId ?? library.songs[0]?.id
  return library.songs.some((song) => song.id === selectedSongId)
    ? selectedSongId
    : (activeSongId ?? library.songs[0]?.id)
}

export function libraryCloseEffect(hasPendingAction: boolean): "clear_pending" | "close_dialog" {
  return hasPendingAction ? "clear_pending" : "close_dialog"
}

export function libraryDialogSurface(
  hasPendingAction: boolean,
  loading: boolean,
  hasLibrary: boolean,
): "content" | "guard" | "loading" {
  if (hasPendingAction) return "guard"
  return loading || !hasLibrary ? "loading" : "content"
}

export function guardedSwitchDocument(result: SaveResult | null): CurrentDocument | null {
  return result?.kind === "saved_current" ? result.document : null
}

export function libraryCommandNeedsGuard(command: LibraryCommand): boolean {
  switch (command.type) {
    case "open_chart":
    case "new_chart":
      return true
    case "delete_chart":
    case "delete_song":
      return command.base_revision !== undefined
    case "delete_archive":
    case "duplicate_chart":
    case "import_archive":
    case "rename_chart":
    case "rename_song":
      return false
  }
}

export function libraryCommandAtRevisions(
  command: LibraryCommand,
  revisions: LibraryWriteRevisions,
): LibraryCommand {
  switch (command.type) {
    case "open_chart":
    case "new_chart":
      return {
        ...command,
        library_revision: revisions.libraryRevision,
        base_revision: revisions.documentRevision,
      }
    case "delete_chart":
    case "delete_song":
      return {
        ...command,
        library_revision: revisions.libraryRevision,
        ...(command.base_revision === undefined
          ? {}
          : { base_revision: revisions.documentRevision }),
      }
    case "delete_archive":
    case "duplicate_chart":
    case "import_archive":
    case "rename_chart":
    case "rename_song":
      return { ...command, library_revision: revisions.libraryRevision }
  }
}

export type LibraryWriteRevisions = {
  readonly documentRevision: Revision
  readonly libraryRevision: LibraryRevision
}

export function newSongAtRevisions(input: NewSong, revisions: LibraryWriteRevisions): NewSong {
  return {
    ...input,
    library_revision: revisions.libraryRevision,
    base_revision: revisions.documentRevision,
  }
}

export function audioInputAtRevisions(revisions: LibraryWriteRevisions): {
  readonly library_revision: LibraryRevision
  readonly base_revision: Revision
} {
  return {
    library_revision: revisions.libraryRevision,
    base_revision: revisions.documentRevision,
  }
}

export type LibraryMutationDocumentPolicy = "library_only" | "replace_document"
export type LibraryDocumentEffect = "accept" | "preserve" | "stale"

export function libraryDocumentEffect(
  policy: LibraryMutationDocumentPolicy,
  currentRevision: number,
  responseRevision: number,
): LibraryDocumentEffect {
  if (policy === "replace_document") return "accept"
  return currentRevision === responseRevision ? "preserve" : "stale"
}
