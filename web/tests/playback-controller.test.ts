import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { boundedAudioSeconds } from "../src/ui/audio-playback-state.ts"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("keeps unavailable audio unavailable when the editing cursor is scrubbed", async () => {
  const demo = await loadDemo(repoRoot)
  const playback = new AudioPlaybackController(demo.document.project)

  playback.seek(8)

  expect(playback.getSnapshot().status).toBe("no-audio")
  expect(playback.getSnapshot().chartTick).toBeNull()
})

it("clamps chart seeks to the real audio duration", () => {
  // Given an audio element shorter than the chart timing span
  const audio = { duration: 3.25 } satisfies Pick<HTMLAudioElement, "duration">

  // When a seek requests a later audio time
  const seconds = boundedAudioSeconds(audio, 8_000_000)

  // Then the native media duration is the upper bound
  expect(seconds).toBe(3.25)
})
