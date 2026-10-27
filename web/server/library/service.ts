import { randomUUID } from "node:crypto"

import { RevisionSchema, StudioProjectV1Schema, type UcsChart } from "../../shared/index.ts"
import {
  ChartIdSchema,
  type LibraryMutation,
  LibraryRevisionSchema,
  type SongId,
  SongIdSchema,
} from "../../shared/library.ts"
import type { ImportChart, LibraryCommand, NewSong } from "../../shared/library-commands.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord, StudioStore } from "../store.ts"
import { requiredBase } from "./command-guards.ts"
import { executeLibraryCommand } from "./commands.ts"
import {
  bumpLibrary,
  expectRevision,
  mutation,
  requireSong,
  storedChart,
} from "./mutation-helpers.ts"
import { bindingFor, digestBytes, newSongProject } from "./project-factory.ts"

export class LibraryService {
  constructor(readonly store: StudioStore) {}

  command(command: LibraryCommand): Promise<LibraryMutation> {
    return executeLibraryCommand(this.store, command)
  }

  createSong(input: NewSong, audio: AudioRecord): Promise<LibraryMutation> {
    return this.store.transact(input.library_revision, (state) => {
      expectRevision(state, input.base_revision)
      const songId = SongIdSchema.parse(randomUUID())
      const chartId = ChartIdSchema.parse(randomUUID())
      const binding = bindingFor(audio.bytes, audio.format)
      const project = newSongProject(input, binding, state.document.project)
      const next = {
        ...state,
        document: { revision: RevisionSchema.parse(state.document.revision + 1), project },
        library: {
          ...state.library,
          revision: LibraryRevisionSchema.parse(state.library.revision + 1),
          active_chart_id: chartId,
          songs: [
            ...state.library.songs,
            { id: songId, title: input.title, artist: input.artist, audio: binding },
          ],
          charts: [
            ...state.library.charts,
            storedChart(chartId, songId, input.chart_name, input.mode, project),
          ],
        },
      }
      return {
        state: next,
        result: mutation(next),
        assets: [
          { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes },
        ],
      }
    })
  }

  rebindAudio(
    songId: SongId,
    libraryRevision: number,
    baseRevision: number | undefined,
    audio: AudioRecord,
  ): Promise<LibraryMutation> {
    return this.store.transact(libraryRevision, (state) => {
      const song = requireSong(state, songId)
      const active = state.library.charts.find(
        (chart) => chart.id === state.library.active_chart_id,
      )
      const activeSong = active?.song_id === song.id
      if (activeSong) expectRevision(state, requiredBase(baseRevision))
      const binding = bindingFor(audio.bytes, audio.format)
      const digest = digestBytes(binding.sha256)
      const charts = state.library.charts.map((chart) =>
        chart.song_id === song.id
          ? {
              ...chart,
              project: StudioProjectV1Schema.parse({
                ...chart.project,
                music: { ...chart.project.music, audio_sha256: digest },
                audio_asset: { format: binding.format, byte_length: binding.byte_length },
              }),
            }
          : chart,
      )
      const activeChart = charts.find((chart) => chart.id === state.library.active_chart_id)
      const next = {
        ...state,
        document:
          activeSong && activeChart !== undefined
            ? {
                revision: RevisionSchema.parse(state.document.revision + 1),
                project: activeChart.project,
              }
            : state.document,
        library: {
          ...state.library,
          revision: LibraryRevisionSchema.parse(state.library.revision + 1),
          songs: state.library.songs.map((candidate) =>
            candidate.id === song.id ? { ...candidate, audio: binding } : candidate,
          ),
          charts,
        },
      }
      return {
        state: next,
        result: mutation(next),
        assets: [
          { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes },
        ],
      }
    })
  }

  importChart(songId: SongId, input: ImportChart, imported: UcsChart): Promise<LibraryMutation> {
    return this.store.transact(input.library_revision, (state) => {
      const song = requireSong(state, songId)
      const source = state.library.charts.find((chart) => chart.song_id === song.id)
      if (source === undefined)
        throw new StudioError(409, "song_chart_missing", "Song has no chart metadata")
      const project = StudioProjectV1Schema.safeParse({
        ...source.project,
        chart: imported.chart,
        music: imported.music,
        audio_asset: { format: song.audio.format, byte_length: song.audio.byte_length },
        ucs_mode: imported.mode,
      })
      if (!project.success)
        throw new StudioError(
          422,
          "ucs_project_incompatible",
          `UCS cannot join this song: ${project.error.issues.map((issue) => issue.message).join("; ")}`,
        )
      const chart = storedChart(
        ChartIdSchema.parse(randomUUID()),
        song.id,
        input.name,
        imported.mode,
        project.data,
      )
      const next = bumpLibrary(state, { charts: [...state.library.charts, chart] })
      return { state: next, result: mutation(next) }
    })
  }
}
