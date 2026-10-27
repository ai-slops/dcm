import { createHash } from "node:crypto"

import { ChartDocumentSchema, type StudioProjectV1, type UcsChart } from "../../shared/index.ts"
import type { ArchiveSourceTiming, LibrarySong, SongId } from "../../shared/library.ts"
import { type UcsArchiveEntry, UcsArchiveError } from "../../src/domain/archive-policy.ts"
import { StudioError } from "../errors.ts"
import { archiveAudioFormat } from "../library/archive-names.ts"
import { parseArchiveInWorker } from "../library/archive-resource.ts"
import {
  compatibleEvaluationContract,
  digestBytes,
  nativeMetadata,
} from "../library/project-factory.ts"
import type { NativeUcsService } from "../native/ucs.ts"
import type { AudioRecord, StudioStore } from "../store.ts"

export class SongTemplateService {
  readonly #cache = new Map<string, Promise<UcsChart>>()

  constructor(
    readonly store: StudioStore,
    readonly ucs: NativeUcsService,
  ) {}

  async read(songId: SongId): Promise<StudioProjectV1> {
    const library = this.store.library()
    const song = library.songs.find((candidate) => candidate.id === songId)
    if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
    const sourceChart = library.charts.find((chart) => chart.song_id === song.id)
    if (sourceChart === undefined)
      throw new StudioError(409, "song_chart_missing", "Song has no chart metadata")
    const source = this.store.chartDocument(sourceChart.id).project
    const archiveSource = await this.#source(song, sourceChart.name)
    return ChartDocumentSchema.parse({
      schema_version: 1,
      title: nativeMetadata(song.title),
      artist: nativeMetadata(song.artist),
      music: { ...archiveSource.timing, audio_sha256: digestBytes(song.audio.sha256) },
      chart: {
        ticks_per_beat: archiveSource.timing.ticks_per_beat,
        span_ticks: archiveSource.timing.duration_ticks,
        notes: [],
      },
      evaluation_contract: compatibleEvaluationContract(
        source,
        archiveSource.timing.duration_ticks,
      ),
      audio_asset: { format: song.audio.format, byte_length: song.audio.byte_length },
      ucs_mode: archiveSource.mode,
    })
  }

  async #source(song: LibrarySong, sourceChartName: string): Promise<ArchiveSourceTiming> {
    if (song.archive_source !== undefined) return song.archive_source
    if (song.archive_id === undefined) {
      const source = this.store.library().charts.find((chart) => chart.song_id === song.id)
      if (source === undefined)
        throw new StudioError(409, "song_chart_missing", "Song has no chart metadata")
      const project = this.store.chartDocument(source.id).project
      const { audio_sha256: _audioDigest, ...timing } = project.music
      return { chart_name: source.name, audio_name: "", mode: source.mode, timing }
    }
    const archive = this.store.library().archives.find((item) => item.id === song.archive_id)
    if (archive === undefined)
      throw new StudioError(500, "library_corrupt", "Song source archive is missing")
    let parsedArchive: Awaited<ReturnType<typeof parseArchiveInWorker>>
    try {
      parsedArchive = await parseArchiveInWorker(
        await this.store.archiveFile(song.archive_id),
        archive.name,
      )
    } catch (error) {
      if (error instanceof UcsArchiveError) throw new StudioError(400, error.code, error.message)
      throw error
    }
    const chart = selectEntry(parsedArchive.charts, sourceChartName, "chart")
    const matchingAudio = parsedArchive.audio.filter(
      (entry) => createHash("sha256").update(entry.data).digest("hex") === song.audio.sha256,
    )
    const audio = selectEntry(
      matchingAudio.length > 0 ? matchingAudio : parsedArchive.audio,
      undefined,
      "audio",
    )
    const key = `${archive.sha256}:${chart.name}:${audio.name}:${song.audio.sha256}`
    let parsed = this.#cache.get(key)
    if (parsed === undefined) {
      const format = archiveAudioFormat(audio.name)
      parsed = this.ucs.import(chart.data, audioRecord(audio.data, format))
      this.#cache.set(key, parsed)
      if (this.#cache.size > 16) {
        const oldest = this.#cache.keys().next().value
        if (oldest !== undefined) this.#cache.delete(oldest)
      }
      void parsed.catch(() => this.#cache.delete(key))
    }
    const imported = await parsed
    const { audio_sha256: _audioDigest, ...timing } = imported.music
    return { chart_name: "", audio_name: "", mode: imported.mode, timing }
  }
}

function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return { bytes, format, digest: createHash("sha256").update(bytes).digest("hex") }
}

function selectEntry(
  entries: readonly UcsArchiveEntry[],
  exactName: string | undefined,
  kind: "chart" | "audio",
): UcsArchiveEntry {
  const exact = exactName === undefined ? [] : entries.filter((entry) => entry.name === exactName)
  const exactEntry = exact.at(0)
  if (exact.length === 1 && exactEntry !== undefined) return exactEntry
  const onlyEntry = entries.at(0)
  if (exact.length === 0 && entries.length === 1 && onlyEntry !== undefined) return onlyEntry
  if (entries.length === 0)
    throw new StudioError(422, "archive_source_missing", `Source archive has no ${kind}`)
  throw new StudioError(
    409,
    "archive_source_ambiguous",
    `Source archive ${kind} is ambiguous; choose and re-import the exact source`,
  )
}
