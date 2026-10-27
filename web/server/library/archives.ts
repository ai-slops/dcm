import { createHash, randomUUID } from "node:crypto"

import { strToU8, zipSync } from "fflate"

import { StudioProjectV1Schema, type UcsChart } from "../../shared/index.ts"
import {
  ArchiveIdSchema,
  ChartIdSchema,
  type LibraryMutation,
  LibraryMutationSchema,
  LibraryRevisionSchema,
  MAX_LIBRARY_ARCHIVES,
  MAX_LIBRARY_CHARTS,
  MAX_LIBRARY_SONGS,
  type SongId,
  SongIdSchema,
} from "../../shared/library.ts"
import type { DownloadArchive, LibraryCommand } from "../../shared/library-commands.ts"
import { type UcsArchiveEntry, UcsArchiveError } from "../../src/domain/archive-policy.ts"
import { StudioError } from "../errors.ts"
import type { NativeUcsService } from "../native/ucs.ts"
import type { AudioRecord, StudioStore } from "../store.ts"
import { archiveAudioFormat, archiveLabel, chartFilename } from "./archive-names.ts"
import { parseArchiveInWorker } from "./archive-resource.ts"
import { downloadUcsPackage } from "./download.ts"
import { bindingFor, nativeMetadata } from "./project-factory.ts"
import { chartSummary, type PersistedStateV2, snapshot } from "./state.ts"

type StageMetadata = {
  readonly name: string
  readonly source_url?: string
  readonly title?: string
  readonly artist?: string
}

export class LibraryArchives {
  constructor(
    readonly store: StudioStore,
    readonly ucs: NativeUcsService,
  ) {}

  async stage(
    libraryRevision: number,
    file: File,
    metadata: StageMetadata = { name: file.name },
  ): Promise<LibraryMutation> {
    preflightStage(this.store, libraryRevision)
    const bytes = new Uint8Array(await file.arrayBuffer())
    return this.#stageBytes(libraryRevision, bytes, metadata)
  }

  async download(input: DownloadArchive, signal: AbortSignal): Promise<LibraryMutation> {
    preflightStage(this.store, input.library_revision)
    const downloaded = await downloadUcsPackage(input.code, signal)
    return this.#stageBytes(input.library_revision, downloaded.bytes, downloaded)
  }

  async import(
    command: Extract<LibraryCommand, { readonly type: "import_archive" }>,
  ): Promise<LibraryMutation> {
    const library = this.store.library()
    requireLibraryRevision(library.revision, command.library_revision)
    const staged = library.archives.find((archive) => archive.id === command.archive_id)
    if (staged === undefined)
      throw new StudioError(404, "archive_not_found", "Archive was not found")
    if (new Set(command.chart_names).size !== command.chart_names.length)
      throw new StudioError(400, "archive_chart_duplicate", "Choose each chart once")
    if (library.songs.length >= MAX_LIBRARY_SONGS)
      throw new StudioError(409, "song_limit", "Library already contains 64 songs")
    if (library.charts.length + command.chart_names.length > MAX_LIBRARY_CHARTS)
      throw new StudioError(409, "chart_limit", "Library cannot contain more than 128 charts")
    const bytes = await this.store.archiveFile(command.archive_id)
    const archive = await parseArchive(bytes, staged.name)
    const audioEntry = requireEntry(archive.audio, command.audio_name, "audio")
    const chartEntries = command.chart_names.map((name) =>
      requireEntry(archive.charts, name, "chart"),
    )
    const format = archiveAudioFormat(audioEntry.name)
    const audio = audioRecord(audioEntry.data, format)
    const imported: UcsChart[] = []
    for (const entry of chartEntries) imported.push(await this.ucs.import(entry.data, audio))
    const template = this.store.document().project
    const projects = imported.map((ucsChart) => {
      const parsed = StudioProjectV1Schema.safeParse({
        ...template,
        title: nativeMetadata(command.title),
        artist: nativeMetadata(command.artist),
        chart: ucsChart.chart,
        music: ucsChart.music,
        audio_asset: { format, byte_length: audio.bytes.byteLength },
        ucs_mode: ucsChart.mode,
      })
      if (!parsed.success)
        throw new StudioError(
          422,
          "ucs_project_incompatible",
          `UCS cannot be imported: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        )
      return parsed.data
    })
    return this.store.transact(command.library_revision, (state) => {
      if (!state.library.archives.some((candidate) => candidate.id === command.archive_id))
        throw new StudioError(
          404,
          "archive_not_found",
          "Archive was deleted before import completed",
        )
      if (state.library.songs.length >= MAX_LIBRARY_SONGS)
        throw new StudioError(409, "song_limit", "Library already contains 64 songs")
      if (state.library.charts.length + projects.length > MAX_LIBRARY_CHARTS)
        throw new StudioError(409, "chart_limit", "Library cannot contain more than 128 charts")
      const songId = SongIdSchema.parse(randomUUID())
      const binding = bindingFor(audio.bytes, audio.format)
      const charts = projects.map((project, index) => ({
        id: ChartIdSchema.parse(randomUUID()),
        song_id: songId,
        name: chartEntries[index]?.name ?? `Chart ${index + 1}`,
        mode: imported[index]?.mode ?? "Double",
        ...chartSummary(project),
        project,
      }))
      const next = {
        ...state,
        library: {
          ...state.library,
          revision: LibraryRevisionSchema.parse(state.library.revision + 1),
          songs: [
            ...state.library.songs,
            {
              id: songId,
              title: command.title,
              artist: command.artist,
              audio: binding,
              archive_id: command.archive_id,
            },
          ],
          charts: [...state.library.charts, ...charts],
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

  async exportSong(songId: SongId, signal?: AbortSignal): Promise<Uint8Array> {
    const library = this.store.library()
    const song = library.songs.find((candidate) => candidate.id === songId)
    if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
    const charts = library.charts.filter((chart) => chart.song_id === song.id)
    const documents = charts.map((chart) => this.store.chartDocument(chart.id))
    const audio = await this.store.songAudio(song.id)
    const ucsFiles = await Promise.all(
      documents.map((document) => this.ucs.export(document.project, document.chart.mode, signal)),
    )
    const files: Record<string, Uint8Array> = {}
    for (const [index, chart] of charts.entries())
      files[chartFilename(files, chart.name, index)] = ucsFiles[index] ?? new Uint8Array()
    files[`music.${audio.format}`] = audio.bytes
    files["pump-library.json"] = strToU8(
      JSON.stringify({
        version: 1,
        title: song.title,
        artist: song.artist,
        charts: charts.map((chart) => chart.name),
      }),
    )
    return zipSync(files, { level: 6 })
  }

  async #stageBytes(
    libraryRevision: number,
    bytes: Uint8Array,
    metadata: StageMetadata,
  ): Promise<LibraryMutation> {
    const archive = await parseArchive(bytes, metadata.name)
    const digest = createHash("sha256").update(bytes).digest("hex")
    return this.store.transact(libraryRevision, (state) => {
      if (state.library.archives.length >= MAX_LIBRARY_ARCHIVES)
        throw new StudioError(409, "archive_limit", "Delete an archive before staging another")
      const stored = {
        id: ArchiveIdSchema.parse(randomUUID()),
        name: archiveLabel(metadata.name),
        sha256: digest,
        byte_length: bytes.byteLength,
        ...(metadata.source_url === undefined ? {} : { source_url: metadata.source_url }),
        ...(metadata.title === undefined ? {} : { title: metadata.title }),
        ...(metadata.artist === undefined ? {} : { artist: metadata.artist }),
        chart_names: archive.charts.map((entry) => entry.name),
        audio_names: archive.audio.map((entry) => entry.name),
      }
      const next = {
        ...state,
        library: {
          ...state.library,
          revision: LibraryRevisionSchema.parse(state.library.revision + 1),
          archives: [...state.library.archives, stored],
        },
      }
      return {
        state: next,
        result: mutation(next),
        assets: [{ directory: "archives", digest, extension: "zip", bytes }],
      }
    })
  }
}

async function parseArchive(bytes: Uint8Array, name: string) {
  try {
    return await parseArchiveInWorker(bytes, name)
  } catch (error) {
    if (error instanceof UcsArchiveError) throw new StudioError(400, error.code, error.message)
    throw error
  }
}

function preflightStage(store: StudioStore, libraryRevision: number): void {
  const library = store.library()
  requireLibraryRevision(library.revision, libraryRevision)
  if (library.archives.length >= MAX_LIBRARY_ARCHIVES)
    throw new StudioError(409, "archive_limit", "Delete an archive before staging another")
}

function requireLibraryRevision(current: number, requested: number): void {
  if (current !== requested)
    throw new StudioError(409, "library_revision_conflict", "Library revision is stale", current)
}

function requireEntry(
  entries: readonly UcsArchiveEntry[],
  name: string,
  kind: string,
): UcsArchiveEntry {
  const entry = entries.find((candidate) => candidate.name === name)
  if (entry === undefined)
    throw new StudioError(
      400,
      `archive_${kind}_missing`,
      `Selected ${kind} is not in the staged archive`,
    )
  return entry
}

function mutation(state: PersistedStateV2): LibraryMutation {
  return LibraryMutationSchema.parse({ document: state.document, library: snapshot(state) })
}

function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return { bytes, format, digest: createHash("sha256").update(bytes).digest("hex") }
}
