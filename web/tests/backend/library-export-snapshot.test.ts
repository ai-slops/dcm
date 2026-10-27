import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unzipSync } from "fflate"
import { expect, it, vi } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { LibraryArchives } from "../../server/library/archives.ts"
import { LibraryService } from "../../server/library/service.ts"
import { NativeUcsService } from "../../server/native/ucs.ts"
import { StudioStore } from "../../server/store.ts"
import { repoRoot } from "../support/paths.ts"

it("exports one chart/audio snapshot when the song changes during native conversion", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-export-snapshot-"))
  try {
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const song = store.library().songs[0]
    expect(song).toBeDefined()
    if (song === undefined) throw new Error("Expected initial song")
    const ucs = new NativeUcsService(repoRoot)
    const convert = ucs.export.bind(ucs)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    vi.spyOn(ucs, "export").mockImplementation(async (project, mode, signal) => {
      entered.resolve()
      await resume.promise
      return convert(project, mode, signal)
    })
    const exported = new LibraryArchives(store, ucs).exportSong(song.id)
    await entered.promise
    const changedAudio = Uint8Array.from(demo.audio)
    changedAudio[changedAudio.length - 1] = (changedAudio.at(-1) ?? 0) ^ 1

    // When
    try {
      await store.save(store.document().revision, {
        ...demo.document.project,
        chart: { ...demo.document.project.chart, notes: [] },
      })
      await new LibraryService(store).rebindAudio(
        song.id,
        store.library().revision,
        store.document().revision,
        {
          bytes: changedAudio,
          format: "wav",
          digest: createHash("sha256").update(changedAudio).digest("hex"),
        },
      )
    } finally {
      resume.resolve()
    }
    const files = unzipSync(await exported)

    // Then
    expect(files["music.wav"]).toEqual(Uint8Array.from(demo.audio))
    expect(files["Main.ucs"]).toEqual(
      Uint8Array.from(await convert(demo.document.project, "Double")),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
