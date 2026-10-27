import assert from "node:assert/strict"

import { strToU8, zipSync } from "fflate"

import { loadDemo } from "../../server/demo.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import { bootstrap, repoRoot } from "./ucs-support.mjs"

export async function libraryAction(context, url, command) {
  const state = await bootstrap(context, url)
  const response = await context.request.post(new URL("/api/v1/library/actions", url).toString(), {
    headers: { "x-csrf-token": state.csrf_token },
    data: command,
  })
  assert.equal(response.status(), 200, await response.text())
  return LibraryMutationSchema.parse(await response.json())
}

export async function createTimingZip(context, url) {
  const state = await bootstrap(context, url)
  const library = await librarySnapshot(context, url)
  const demo = await loadDemo(repoRoot)
  const source = [
    ":Format=1",
    ":Mode=Double",
    ":BPM=120",
    ":Delay=125",
    ":Beat=4",
    ":Split=4",
    ...Array.from({ length: 8 }, () => ".........."),
    ":BPM=150",
    ":Delay=0",
    ":Split=8",
    ...Array.from({ length: 8 }, () => ".........."),
    "",
  ].join("\r\n")
  const bytes = zipSync({ "original.ucs": strToU8(source), "music.wav": demo.audio })
  const staged = await context.request.post(new URL("/api/v1/library/archives", url).toString(), {
    headers: { "x-csrf-token": state.csrf_token },
    multipart: {
      library_revision: String(library.revision),
      file: {
        name: "independent-timing-fixture.zip",
        mimeType: "application/zip",
        buffer: Buffer.from(bytes),
      },
    },
  })
  assert.equal(staged.status(), 200, await staged.text())
  const mutation = LibraryMutationSchema.parse(await staged.json())
  const original = new Set(library.archives.map((archive) => archive.id))
  const archive = mutation.library.archives.find((item) => !original.has(item.id))
  assert.ok(archive)
  const imported = await libraryAction(context, url, {
    type: "import_archive",
    library_revision: mutation.library.revision,
    archive_id: archive.id,
    chart_names: ["original.ucs"],
    audio_name: "music.wav",
    title: "Timing source QA",
    artist: "Independent fixture",
  })
  const oldSongs = new Set(library.songs.map((song) => song.id))
  const song = imported.library.songs.find((item) => !oldSongs.has(item.id))
  assert.ok(song)
  const chart = imported.library.charts.find((item) => item.song_id === song.id)
  assert.ok(chart)
  return { song, chart, archive }
}
