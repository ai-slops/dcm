import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { boundedAudioSeconds, validatedPlaybackSegment } from "../src/ui/audio-playback-state.ts"
import {
  AudioPlaybackController,
  type AudioPlaybackEnvironment,
  type PlaybackMedia,
} from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

class FakePlaybackMedia implements PlaybackMedia {
  currentTime = 0
  duration = 10
  ended = false
  loop = false
  paused = true
  playbackRate = 1
  preload = ""
  volume = 1
  oncanplay: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  onloadedmetadata: (() => void) | null = null
  onpause: (() => void) | null = null
  onplay: (() => void) | null = null
  ontimeupdate: (() => void) | null = null

  pause(): void {
    this.paused = true
    this.onpause?.()
  }

  async play(): Promise<void> {
    this.paused = false
    this.ended = false
    this.onplay?.()
  }
}

function fakePlaybackEnvironment(media: FakePlaybackMedia): {
  readonly environment: AudioPlaybackEnvironment
  readonly runFrame: () => void
} {
  let frame: (() => void) | null = null
  return {
    environment: {
      cancelFrame: () => {
        frame = null
      },
      createAudio: () => media,
      createObjectUrl: () => "blob:test-audio",
      loadAudio: async () => new Blob(["audio"]),
      requestFrame: (callback) => {
        frame = callback
        return 1
      },
      revokeObjectUrl: () => undefined,
    },
    runFrame: () => {
      const callback = frame
      frame = null
      callback?.()
    },
  }
}

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

it("accepts a finite audio-second segment ending at the media duration", () => {
  // Given finite media duration and a bounded audition range
  const durationSeconds = 12.5

  // When the segment boundary is parsed
  const segment = validatedPlaybackSegment(2.25, durationSeconds, true, durationSeconds)

  // Then the exact end-of-media boundary remains valid
  expect(segment).toEqual({ startSeconds: 2.25, endSeconds: 12.5, loop: true })
})

it.each([
  [Number.NaN, 2, 5],
  [0, Number.POSITIVE_INFINITY, 5],
  [-1, 2, 5],
  [2, 2, 5],
  [2, 6, 5],
  [0, 1, Number.NaN],
])("rejects invalid audio-second segment %#", (startSeconds, endSeconds, durationSeconds) => {
  // Given invalid or out-of-duration audio-second boundaries
  // When validation runs
  const validate = () => validatedPlaybackSegment(startSeconds, endSeconds, false, durationSeconds)

  // Then callers receive a useful range error without a partial segment
  expect(validate).toThrowError(RangeError)
})

it("pauses and clamps the media clock at a selected segment end", async () => {
  // Given ready media with a finite ten-second duration
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.load(true)
  await Promise.resolve()
  media.onloadedmetadata?.()
  media.oncanplay?.()

  // When playback crosses the selected non-looping end
  await playback.playSegment(2, 4, false)
  media.currentTime = 4.25
  fake.runFrame()

  // Then the real media clock is paused exactly at the chosen boundary
  expect(media.paused).toBe(true)
  expect(media.currentTime).toBe(4)
  expect(playback.getSnapshot().status).toBe("paused")
  expect(playback.getSnapshot().segment).toEqual({
    startSeconds: 2,
    endSeconds: 4,
    loop: false,
  })
})

it("loops a selected segment without enabling full-song media loop", async () => {
  // Given ready media and an existing full-song loop preference
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.setLoop(true)
  playback.load(true)
  await Promise.resolve()
  media.onloadedmetadata?.()
  media.oncanplay?.()

  // When the selected looping segment reaches its end
  await playback.playSegment(3, 5, true)
  media.currentTime = 5
  fake.runFrame()

  // Then only the selected range loops and the full-song preference is retained
  expect(media.currentTime).toBe(3)
  expect(media.loop).toBe(false)
  expect(playback.getSnapshot().loop).toBe(true)
  expect(playback.getSnapshot().status).toBe("playing")
})

it("restarts a looping segment ending at media duration from the ended event", async () => {
  // Given a looping range whose end equals the actual media duration
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.load(true)
  await Promise.resolve()
  media.onloadedmetadata?.()
  media.oncanplay?.()
  await playback.playSegment(7, 10, true)

  // When the native media element reports that playback ended
  media.currentTime = 10
  media.ended = true
  media.paused = true
  media.onended?.()
  await Promise.resolve()

  // Then segment playback restarts at its selected start
  expect(media.currentTime).toBe(7)
  expect(media.paused).toBe(false)
  expect(playback.getSnapshot().status).toBe("playing")
})

it("keeps playback state unchanged when a segment range is invalid", async () => {
  // Given ready media at a stable playback position
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.load(true)
  await Promise.resolve()
  media.onloadedmetadata?.()
  media.oncanplay?.()
  media.currentTime = 1.5
  const before = playback.getSnapshot()

  // When an out-of-duration segment is requested
  const request = playback.playSegment(4, 12, false)

  // Then the range error does not poison status, position, or segment state
  await expect(request).rejects.toThrowError(RangeError)
  expect(playback.getSnapshot()).toBe(before)
  expect(media.currentTime).toBe(1.5)
})

it("enforces the range on media events without animation frames", async () => {
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.load(true)
  await Promise.resolve()
  media.oncanplay?.()
  await playback.playSegment(2, 4, false)
  media.currentTime = 4.25
  media.ontimeupdate?.()
  expect(media.paused).toBe(true)
  expect(media.currentTime).toBe(4)
})

it("ignores an aborted old play request after audio is unloaded", async () => {
  const demo = await loadDemo(repoRoot)
  const media = new FakePlaybackMedia()
  const fake = fakePlaybackEnvironment(media)
  const playback = new AudioPlaybackController(demo.document.project, fake.environment)
  playback.load(true)
  await Promise.resolve()
  media.oncanplay?.()
  media.play = () => Promise.reject(new DOMException("Audio replaced", "AbortError"))
  const request = playback.playSegment(2, 4, false)
  playback.unload()
  await request
  expect(playback.getSnapshot().status).toBe("no-audio")
})
