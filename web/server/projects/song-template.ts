import { createHash } from "node:crypto"

import { type BeatChartDocument, BeatChartDocumentSchema } from "../../shared/beat-projects.ts"
import type { UcsChart } from "../../shared/index.ts"
import type { ArchiveSourceTiming, LibrarySong, SongId } from "../../shared/library.ts"
import { type UcsArchiveEntry, UcsArchiveError } from "../../src/domain/archive-policy.ts"
import { StudioError } from "../errors.ts"
import { archiveAudioFormat } from "../library/archive-names.ts"
import { parseArchiveInWorker } from "../library/archive-resource.ts"
import { migrateTiming } from "../library/legacy-beat-migration.ts"
import type { NativeUcsService } from "../native/ucs.ts"
import type { AudioRecord, StudioStore } from "../store.ts"

export class SongTemplateService {
  readonly #cache = new Map<string, Promise<UcsChart>>()

  constructor(
    readonly store: StudioStore,
    readonly ucs: NativeUcsService,
  ) {}

  async read(songId: SongId): Promise<BeatChartDocument> {
    const library = this.store.library()
    const song = library.songs.find((candidate) => candidate.id === songId)
    if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
    const sourceChart = library.charts.find((chart) => chart.song_id === song.id)
    if (sourceChart === undefined)
      throw new StudioError(409, "song_chart_missing", "Song has no chart metadata")
    const source = this.store.chartDocument(sourceChart.id).project
    const archiveSource = await this.#source(song, sourceChart.name)
    return BeatChartDocumentSchema.parse({
      schema_version: 1,
      title: song.title,
      artist: song.artist,
      chart_artist: null,
      mode: archiveSource.mode,
      timing: archiveSource.timing,
      notes: [],
      audio_sha256: song.audio.sha256,
      evaluation_contract: source.evaluation_contract,
      audio_asset: { format: song.audio.format, byte_length: song.audio.byte_length },
    })
  }

  async #source(song: LibrarySong, sourceChartName: string): Promise<ArchiveSourceTiming> {
    if (song.archive_source !== undefined) return song.archive_source
    if (song.archive_id === undefined) {
      const source = this.store.library().charts.find((chart) => chart.song_id === song.id)
      if (source === undefined)
        throw new StudioError(409, "song_chart_missing", "Song has no chart metadata")
      const project = this.store.chartDocument(source.id).project
      return { chart_name: source.name, audio_name: "", mode: source.mode, timing: project.timing }
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
    return {
      chart_name: chart.name,
      audio_name: audio.name,
      mode: imported.mode,
      timing: migrateTiming(imported.music, imported.music.ticks_per_beat * 4),
    }
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
