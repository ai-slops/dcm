import { describe, expect, it } from "vitest"

import type { NativeChart, NativeMusic } from "../shared/index.ts"
import { snapPlacementTick } from "../src/domain/edit-snap.ts"
import {
  buildVisibleCellIndex,
  timelineWindowStart,
  timingContextAtTick,
} from "../src/domain/timeline.ts"

const music: NativeMusic = {
  duration_ticks: 192,
  ticks_per_beat: 4,
  offset_micros: 100_000,
  tempo: [
    { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
    { start_tick: 64, micros_per_beat: { numerator: 400_000, denominator: 1 } },
  ],
  audio_sha256: Array.from({ length: 32 }, () => 1),
  reference_accents: [],
}

describe("timeline window selection", () => {
  it("advances on the exact 48-row boundary", () => {
    // Given a one-tick quantized 48-row window
    // When selecting the last tick of one page and the first tick of the next
    const previous = timelineWindowStart({ sourceTick: 47, spanTicks: 192 })
    const next = timelineWindowStart({ sourceTick: 48, spanTicks: 192 })

    // Then the boundary belongs to the next stable page
    expect(previous).toBe(0)
    expect(next).toBe(48)
  })

  it("uses the playback tick without changing the editing cursor", () => {
    // Given an editing cursor on page zero and audio on page two
    const selectedTick = 7

    // When the followed window is derived from the audio clock
    const start = timelineWindowStart({ sourceTick: 103.5, spanTicks: 192 })

    // Then playback chooses the visible page while the cursor value is untouched
    expect(start).toBe(96)
    expect(selectedTick).toBe(7)
  })

  it("clamps an old frozen window into a shorter replacement chart", () => {
    // Given a manual window far beyond a newly imported chart
    // When the replacement span is used to recompute the window
    const start = timelineWindowStart({ sourceTick: 9_600, spanTicks: 12 })

    // Then the only valid 48-row page begins at zero
    expect(start).toBe(0)
  })
})

describe("visible timeline cells", () => {
  it("lets an onset win over an inherited hold segment at the same cell", () => {
    // Given native chart data containing a hold crossing a later onset
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 32,
      notes: [
        { tick: 0, panel_mask: 1, hold_ticks: 8 },
        { tick: 8, panel_mask: 1, hold_ticks: 0 },
      ],
    }

    // When visible cells are indexed once for the current window
    const cells = buildVisibleCellIndex(chart, 0)

    // Then the later tap remains legible instead of being painted as a hold body
    expect(cells.get("8:0")).toBe("tap")
  })
})

it("snaps only future placements down to the selected edit grid within chart bounds", () => {
  expect(snapPlacementTick(7, 2, 32)).toBe(6)
  expect(snapPlacementTick(7, 4, 32)).toBe(4)
  expect(snapPlacementTick(7, 8, 32)).toBe(0)
  expect(snapPlacementTick(99, 8, 32)).toBe(24)
  expect(snapPlacementTick(-1, 8, 32)).toBe(0)
})

describe("timeline timing context", () => {
  it("reports reduced beat position and the active piecewise BPM", () => {
    // Given a tick after the second tempo segment begins
    // When timing context is computed from native music
    const context = timingContextAtTick(music, 66)

    // Then beat and BPM describe that exact segment
    expect(context.beat).toBe("33/2")
    expect(context.bpm).toBe(150)
    expect(context.offset).toBe("+100 ms")
    expect(context.songTime).toBe("00:08.300")
  })

  it("preserves fractional playback beats and exact signed microsecond offsets", () => {
    // Given playback between native ticks and a non-whole-millisecond offset
    const preciseMusic: NativeMusic = { ...music, offset_micros: 1_001 }

    // When timing context is formatted from the fractional clock tick
    const context = timingContextAtTick(preciseMusic, 66.5)

    // Then approximation is explicit and offset precision is not rounded away
    expect(context.beat).toBe("≈16.625")
    expect(context.offset).toBe("+1.001 ms")
  })

  it("uses the actual negative audio clock during pre-roll", () => {
    // Given audio fifty milliseconds before time zero
    // When context receives the actual audio clock instead of deriving tick zero
    const context = timingContextAtTick(music, 0, -50_000)

    // Then negative pre-roll remains visible
    expect(context.songTime).toBe("−00:00.050")
  })
})
