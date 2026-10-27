import { randomUUID } from "node:crypto"

import {
  type ChartId,
  ChartIdSchema,
  type LibraryMutation,
  type SongId,
} from "../../shared/library.ts"
import type { LibraryCommand } from "../../shared/library-commands.ts"
import { StudioError } from "../errors.ts"
import type { StudioStore } from "../store.ts"
import { assertNever, requiredBase } from "./command-guards.ts"
import {
  bumpLibrary,
  expectRevision,
  mutation,
  requireChart,
  requireFallback,
  requireFallbackSet,
  requireSong,
  storedChart,
  switchActive,
} from "./mutation-helpers.ts"
import { emptyChartProject } from "./project-factory.ts"

export function executeLibraryCommand(
  store: StudioStore,
  command: LibraryCommand,
): Promise<LibraryMutation> {
  switch (command.type) {
    case "open_chart":
      return openChart(store, command.library_revision, command.base_revision, command.chart_id)
    case "new_chart":
      return newChart(store, command)
    case "duplicate_chart":
      return duplicateChart(store, command.library_revision, command.chart_id, command.name)
    case "rename_chart":
      return renameChart(store, command.library_revision, command.chart_id, command.name)
    case "rename_song":
      return renameSong(
        store,
        command.library_revision,
        command.song_id,
        command.title,
        command.artist,
      )
    case "delete_chart":
      return deleteChart(store, command)
    case "delete_song":
      return deleteSong(store, command)
    case "delete_archive":
      return deleteArchive(store, command.library_revision, command.archive_id)
    case "import_archive":
      throw new StudioError(500, "archive_service", "Archive import service is unavailable")
    default:
      return assertNever(command)
  }
}

function openChart(
  store: StudioStore,
  libraryRevision: number,
  baseRevision: number,
  chartId: ChartId,
): Promise<LibraryMutation> {
  return store.transact(libraryRevision, (state) => {
    expectRevision(state, baseRevision)
    const next = switchActive(state, requireChart(state, chartId))
    return { state: next, result: mutation(next) }
  })
}

function newChart(
  store: StudioStore,
  command: Extract<LibraryCommand, { readonly type: "new_chart" }>,
): Promise<LibraryMutation> {
  return store.transact(command.library_revision, (state) => {
    expectRevision(state, command.base_revision)
    const song = requireSong(state, command.song_id)
    const source = state.library.charts.find((chart) => chart.song_id === song.id)
    if (source === undefined)
      throw new StudioError(409, "song_chart_missing", "Song has no chart to copy timing from")
    const id = ChartIdSchema.parse(randomUUID())
    const project = emptyChartProject(source.project, command.mode)
    const chart = storedChart(id, song.id, command.name, command.mode, project)
    const next = switchActive(
      { ...state, library: { ...state.library, charts: [...state.library.charts, chart] } },
      chart,
    )
    return { state: next, result: mutation(next) }
  })
}

function duplicateChart(
  store: StudioStore,
  libraryRevision: number,
  chartId: ChartId,
  name: string,
): Promise<LibraryMutation> {
  return store.transact(libraryRevision, (state) => {
    const source = requireChart(state, chartId)
    const chart = {
      ...source,
      id: ChartIdSchema.parse(randomUUID()),
      name,
      project: structuredClone(source.project),
    }
    const next = bumpLibrary(state, { charts: [...state.library.charts, chart] })
    return { state: next, result: mutation(next) }
  })
}

function renameChart(
  store: StudioStore,
  libraryRevision: number,
  chartId: ChartId,
  name: string,
): Promise<LibraryMutation> {
  return store.transact(libraryRevision, (state) => {
    requireChart(state, chartId)
    const next = bumpLibrary(state, {
      charts: state.library.charts.map((chart) =>
        chart.id === chartId ? { ...chart, name } : chart,
      ),
    })
    return { state: next, result: mutation(next) }
  })
}

function renameSong(
  store: StudioStore,
  libraryRevision: number,
  songId: SongId,
  title: string,
  artist: string,
): Promise<LibraryMutation> {
  return store.transact(libraryRevision, (state) => {
    requireSong(state, songId)
    const next = bumpLibrary(state, {
      songs: state.library.songs.map((song) =>
        song.id === songId ? { ...song, title, artist } : song,
      ),
    })
    return { state: next, result: mutation(next) }
  })
}

function deleteChart(
  store: StudioStore,
  command: Extract<LibraryCommand, { readonly type: "delete_chart" }>,
): Promise<LibraryMutation> {
  return store.transact(command.library_revision, (state) => {
    requireChart(state, command.chart_id)
    const active = command.chart_id === state.library.active_chart_id
    if (state.library.charts.length === 1)
      throw new StudioError(409, "last_chart", "The last chart cannot be deleted")
    const target = requireChart(state, command.chart_id)
    if (state.library.charts.filter((chart) => chart.song_id === target.song_id).length === 1)
      throw new StudioError(
        409,
        "last_song_chart",
        "Delete the song instead of removing its only chart",
      )
    const fallback = active
      ? requireFallback(state, command.fallback_chart_id, command.chart_id)
      : undefined
    if (active) expectRevision(state, requiredBase(command.base_revision))
    const remaining = state.library.charts.filter((chart) => chart.id !== command.chart_id)
    const next =
      fallback === undefined
        ? bumpLibrary(state, { charts: remaining })
        : switchActive({ ...state, library: { ...state.library, charts: remaining } }, fallback)
    return { state: next, result: mutation(next) }
  })
}

function deleteSong(
  store: StudioStore,
  command: Extract<LibraryCommand, { readonly type: "delete_song" }>,
): Promise<LibraryMutation> {
  return store.transact(command.library_revision, (state) => {
    requireSong(state, command.song_id)
    if (state.library.songs.length === 1)
      throw new StudioError(409, "last_song", "The last song cannot be deleted")
    const removedIds = new Set(
      state.library.charts
        .filter((chart) => chart.song_id === command.song_id)
        .map((chart) => chart.id),
    )
    const active = removedIds.has(state.library.active_chart_id)
    const fallback = active
      ? requireFallbackSet(state, command.fallback_chart_id, removedIds)
      : undefined
    if (active) expectRevision(state, requiredBase(command.base_revision))
    const reduced = {
      ...state,
      library: {
        ...state.library,
        songs: state.library.songs.filter((song) => song.id !== command.song_id),
        charts: state.library.charts.filter((chart) => chart.song_id !== command.song_id),
      },
    }
    const next = fallback === undefined ? bumpLibrary(reduced, {}) : switchActive(reduced, fallback)
    return { state: next, result: mutation(next) }
  })
}

function deleteArchive(
  store: StudioStore,
  libraryRevision: number,
  archiveId: string,
): Promise<LibraryMutation> {
  return store.transact(libraryRevision, (state) => {
    if (!state.library.archives.some((archive) => archive.id === archiveId))
      throw new StudioError(404, "archive_not_found", "Archive was not found")
    const next = bumpLibrary(state, {
      archives: state.library.archives.filter((archive) => archive.id !== archiveId),
      songs: state.library.songs.map((song) =>
        song.archive_id === archiveId
          ? { id: song.id, title: song.title, artist: song.artist, audio: song.audio }
          : song,
      ),
    })
    return { state: next, result: mutation(next) }
  })
}
