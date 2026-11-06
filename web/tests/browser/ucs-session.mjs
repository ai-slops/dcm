import assert from "node:assert/strict"

import { CurrentDocumentSchema } from "../../shared/index.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import { bootstrap } from "./ucs-support.mjs"

export async function createUcsSession(context, url, input) {
  const before = await bootstrap(context, url)
  const originalAudioResponse = await context.request.get(new URL("/api/v1/audio", url).toString())
  assert.equal(originalAudioResponse.status(), 200)
  const originalAudio = await originalAudioResponse.body()
  const library = await librarySnapshot(context, url)
  const response = await context.request.post(new URL("/api/v1/library/songs", url).toString(), {
    headers: { "x-csrf-token": before.csrf_token },
    multipart: {
      input: JSON.stringify({
        library_revision: library.revision,
        base_revision: before.document.revision,
        title: "Disposable UCS browser scenario",
        artist: "Independent fixture",
        chart_name: "Initial fixture chart",
        mode: input.mode,
        bpm: 120,
        beats: 128,
      }),
      audio: { name: "music.wav", mimeType: "audio/wav", buffer: input.audio },
    },
  })
  assert.equal(response.status(), 200, await response.text())
  const created = LibraryMutationSchema.parse(await response.json())
  const oldSongs = new Set(library.songs.map((song) => song.id))
  const song = created.library.songs.find((item) => !oldSongs.has(item.id))
  assert.ok(song)
  return {
    before: before.document,
    originalAudio,
    originalChartId: library.active_chart_id,
    songId: song.id,
    document: created.document,
  }
}

export async function openSingleFixture(context, url, songId) {
  const current = await bootstrap(context, url)
  const library = await librarySnapshot(context, url)
  const response = await context.request.post(new URL("/api/v1/library/actions", url).toString(), {
    headers: { "x-csrf-token": current.csrf_token },
    data: {
      type: "new_chart",
      library_revision: library.revision,
      base_revision: current.document.revision,
      song_id: songId,
      name: "Single fixture",
      mode: "Single",
    },
  })
  assert.equal(response.status(), 200, await response.text())
  const opened = LibraryMutationSchema.parse(await response.json()).document
  // The short-import rejection must not depend on the active song's inherited defaults.
  const fixture = await context.request.put(new URL("/api/v1/document", url).toString(), {
    headers: { "x-csrf-token": current.csrf_token },
    data: {
      base_revision: opened.revision,
      project: {
        ...opened.project,
        evaluation_contract: {
          ...opened.project.evaluation_contract,
          difficulty: {
            ...opened.project.evaluation_contract.difficulty,
            local_windows: [{ width: { numerator: 4, denominator: 1 }, maximum_load: 1_000_000 }],
          },
        },
      },
    },
  })
  assert.equal(fixture.status(), 200, await fixture.text())
  return CurrentDocumentSchema.parse(await fixture.json())
}

export async function restoreUcsSession(context, url, session) {
  const current = await bootstrap(context, url)
  assert.deepEqual(
    current.document,
    session.expected,
    "Concurrent edits detected; refusing to replace another author's draft",
  )
  const library = await librarySnapshot(context, url)
  const opened = await context.request.post(new URL("/api/v1/library/actions", url).toString(), {
    headers: { "x-csrf-token": current.csrf_token },
    data: {
      type: "open_chart",
      library_revision: library.revision,
      base_revision: current.document.revision,
      chart_id: session.originalChartId,
    },
  })
  assert.equal(opened.status(), 200, await opened.text())
  const restored = LibraryMutationSchema.parse(await opened.json())
  assert.deepEqual(restored.document.project, session.before.project)
  const restoredAudio = await context.request.get(new URL("/api/v1/audio", url).toString())
  assert.equal(restoredAudio.status(), 200)
  assert.deepEqual(await restoredAudio.body(), session.originalAudio)
  const removed = await context.request.post(new URL("/api/v1/library/actions", url).toString(), {
    headers: { "x-csrf-token": current.csrf_token },
    data: {
      type: "delete_song",
      library_revision: restored.library.revision,
      song_id: session.songId,
    },
  })
  assert.equal(removed.status(), 200, await removed.text())
  console.log("Original active chart and audio restored; disposable UCS song removed.")
}
