import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { NativeUcsService } from "../../server/native/ucs.ts"
import { repoRoot } from "../support/paths.ts"

it("exports and reparses an actual native WASM-generated candidate as an uncertified UCS draft", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-ucs-generated-"))
  try {
    const studio = await createStudioApp(
      loadConfig({ STUDIO_REPO_ROOT: repoRoot, STUDIO_DATA: root }),
    )
    const project = studio.store.document().project
    const audio = studio.store.audio()
    const generated = await studio.native.generate(project, audio, "0".repeat(64))
    const ucs = new NativeUcsService(repoRoot)
    // When
    const exported = await ucs.export({ ...project, chart: generated }, "Double")
    const imported = await ucs.import(exported, audio)
    // Then
    expect(imported.chart).toEqual(generated)
    expect(imported.music.tempo).toEqual(project.music.tempo)
    expect(imported.music.offset_micros).toBe(project.music.offset_micros)
    expect(imported.music.audio_sha256).toEqual(project.music.audio_sha256)
    expect(new TextDecoder().decode(exported)).not.toMatch(/certificate|signature|candidate_id/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
