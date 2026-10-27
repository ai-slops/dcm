import { expect, it, vi } from "vitest"

import { browserAudioPlaybackEnvironmentFor } from "../src/ui/audioPlaybackEnvironment.ts"

it("loads the selected library song through the injected audio source", async () => {
  // Given a loader bound to one selected library song
  const audio = new Blob(["selected-song"])
  const loadAudio = vi.fn(async () => audio)
  const environment = browserAudioPlaybackEnvironmentFor(loadAudio)

  // When the playback environment requests its asset
  const loaded = await environment.loadAudio()

  // Then the injected library loader supplies the media instead of the active Studio endpoint
  expect(loadAudio).toHaveBeenCalledOnce()
  expect(loaded).toBe(audio)
})
