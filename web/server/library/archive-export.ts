import { strToU8, zipSync } from "fflate"

import type { SongId } from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import type { NativeBeatUcsService } from "../native/beat-ucs.ts"
import type { StudioStore } from "../store.ts"
import { chartFilename } from "./archive-names.ts"

export async function exportSongArchive(
  store: StudioStore,
  ucs: NativeBeatUcsService,
  songId: SongId,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const library = store.library()
  const song = library.songs.find((candidate) => candidate.id === songId)
  if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
  const charts = library.charts.filter((chart) => chart.song_id === song.id)
  const documents = charts.map((chart) => store.chartDocument(chart.id))
  const audio = await store.songAudio(song.id)
  const ucsFiles = await Promise.all(
    documents.map((document) =>
      ucs.export(
        {
          timing: document.project.timing,
          notes: document.project.notes,
          mode: document.project.mode,
        },
        signal,
      ),
    ),
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
