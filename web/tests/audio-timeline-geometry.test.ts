import { describe, expect, it } from "vitest"

import {
  AUDIO_TIMELINE_RUNWAY_CENTER,
  audioMicrosAtPhysicalY,
  audioMicrosToPhysicalY,
  audioTimelineFollowPosition,
  audioTimelineGeometry,
  audioTimelineRebasePosition,
  audioTimelineResizePosition,
  audioTimelineVisibleRange,
  audioTimelineZoomPosition,
} from "../src/domain/audio-timeline-geometry.ts"

describe("audio-time timeline geometry", () => {
  it.each([0, 3_250_000])(
    "keeps audio %s at the judgment line when zooming lookahead",
    (audioMicros) => {
      const geometry = audioTimelineGeometry({
        originAudioMicros: 0,
        viewportSize: 680,
        judgmentOffset: 34,
        lookaheadSeconds: 4,
      })
      const scrollTop = audioMicrosToPhysicalY(geometry, audioMicros) - geometry.judgmentOffset

      const zoomed = audioTimelineZoomPosition({
        geometry,
        scrollTop,
        nextViewportSize: 680,
        nextJudgmentOffset: 34,
        lookaheadSeconds: 0.1,
      })

      expect(
        audioMicrosAtPhysicalY(zoomed.geometry, zoomed.scrollTop + zoomed.geometry.judgmentOffset),
      ).toBeCloseTo(audioMicros, 5)
    },
  )

  it("maps the configured future lookahead from the judgment row to the viewport bottom", () => {
    const geometry = audioTimelineGeometry({
      originAudioMicros: 2_000_000,
      viewportSize: 680,
      judgmentOffset: 34,
      lookaheadSeconds: 4,
    })
    const targetY = audioMicrosToPhysicalY(geometry, 2_000_000)
    const scrollTop = targetY - geometry.judgmentOffset
    const range = audioTimelineVisibleRange(geometry, scrollTop)

    expect(range.endMicros - 2_000_000).toBe(4_000_000)
    expect(audioMicrosAtPhysicalY(geometry, targetY)).toBe(2_000_000)
  })

  it("preserves the exact logical audio range through responsive resize", () => {
    const geometry = audioTimelineGeometry({
      originAudioMicros: 500_000,
      viewportSize: 680,
      judgmentOffset: 34,
      lookaheadSeconds: 4,
    })
    const scrollTop = audioMicrosToPhysicalY(geometry, 3_250_000) - geometry.judgmentOffset
    const before = audioTimelineVisibleRange(geometry, scrollTop)

    const resized = audioTimelineResizePosition({
      geometry,
      scrollTop,
      nextViewportSize: 616,
      nextJudgmentOffset: 44,
      lookaheadSeconds: 4,
    })

    expect(audioTimelineVisibleRange(resized.geometry, resized.scrollTop).startMicros).toBeCloseTo(
      before.startMicros,
      5,
    )
  })

  it("rebases a bounded physical runway without moving logical audio", () => {
    const geometry = audioTimelineGeometry({
      originAudioMicros: 0,
      viewportSize: 680,
      judgmentOffset: 34,
      lookaheadSeconds: 4,
    })
    const scrollTop = 1
    const before = audioTimelineVisibleRange(geometry, scrollTop)

    const rebased = audioTimelineRebasePosition({ geometry, scrollTop })

    expect(rebased.scrollTop).toBe(AUDIO_TIMELINE_RUNWAY_CENTER)
    expect(audioTimelineVisibleRange(rebased.geometry, rebased.scrollTop).startMicros).toBeCloseTo(
      before.startMicros,
      8,
    )
  })

  it("follows fractional audio time at the fixed judgment offset", () => {
    const geometry = audioTimelineGeometry({
      originAudioMicros: 0,
      viewportSize: 680,
      judgmentOffset: 34,
      lookaheadSeconds: 4,
    })

    const followed = audioTimelineFollowPosition({ geometry, audioMicros: 1_234_567.5 })

    expect(
      audioMicrosAtPhysicalY(
        followed.geometry,
        followed.scrollTop + followed.geometry.judgmentOffset,
      ),
    ).toBeCloseTo(1_234_567.5, 5)
  })
})
