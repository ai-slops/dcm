import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("keeps unavailable audio unavailable when the editing cursor is scrubbed", async () => {
  const demo = await loadDemo(repoRoot)
  const playback = new AudioPlaybackController(demo.document.project)

  playback.seek(8)

  expect(playback.getSnapshot().status).toBe("no-audio")
  expect(playback.getSnapshot().chartTick).toBeNull()
})
