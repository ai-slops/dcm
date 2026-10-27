import { describe, expect, it } from "vitest"

import { AutomaticRegionViewSchema, type NativeChart, type NativeMusic } from "../shared/index.ts"
import { snapPlacementTick } from "../src/domain/edit-snap.ts"
import {
  buildVisibleCellIndex,
  laneTone,
  timelineFollowPosition,
  timelineLogicalVisibleTick,
  timelinePhysicalScrollBounds,
  timelineRangeIntersectsRegions,
  timelineResizePosition,
  timelineSpanPosition,
  timelineVirtualWindow,
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

describe("continuous virtual timeline", () => {
  it("keeps the visible logical anchor stable when the physical runway rebases", () => {
    // Given the same logical tick before and after a runway rebase
    const before = timelineVirtualWindow({
      originTick: 100_000,
      scrollTop: 34_000,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 1_000_000,
    })
    const after = timelineVirtualWindow({
      originTick: before.visibleTick,
      scrollTop: 68_000,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 1_000_000,
    })

    // When the new origin is paired with the runway center
    // Then the first visible logical tick does not jump
    expect(after.visibleTick).toBe(before.visibleTick)
    expect(after.rows[0]).toBe(before.rows[0])
  })

  it("bounds a million-tick chart while rendering only buffered viewport rows", () => {
    const window = timelineVirtualWindow({
      originTick: 999_990,
      scrollTop: 68_000,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 1_000_000,
    })

    expect(window.rows.at(-1)).toBe(999_999)
    expect(window.rows.length).toBeLessThanOrEqual(60)
  })

  it("advances fractional playback ticks by proportional pixels across a tempo boundary", () => {
    // Given playback samples surrounding a tempo-boundary tick
    const geometry = {
      originTick: 48,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 192,
    }

    // When follow positions keep one viewport-third above the playhead
    const before = timelineFollowPosition({ ...geometry, tick: 63.5, anchorRows: 6 })
    const boundary = timelineFollowPosition({ ...geometry, tick: 64, anchorRows: 6 })
    const after = timelineFollowPosition({ ...geometry, tick: 64.5, anchorRows: 6 })

    // Then every half tick moves exactly half a row without a viewport-sized jump
    expect(boundary.scrollTop - before.scrollTop).toBe(17)
    expect(after.scrollTop - boundary.scrollTop).toBe(17)
  })

  it("clamps manual physical scrolling to the first and last logical viewport", () => {
    const bounds = timelinePhysicalScrollBounds({
      originTick: 0,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 100,
    })

    expect(bounds.minimum).toBe(68_000)
    expect(bounds.maximum).toBe(70_720)
  })

  it("preserves the logical top-row pixel when the finite runway rebases", () => {
    const before = timelineFollowPosition({
      tick: 3_750.25,
      anchorRows: 10,
      originTick: 0,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 10_000,
    })
    const rebased = timelineFollowPosition({
      tick: 3_750.25,
      anchorRows: 10,
      originTick: before.visibleTick,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 10_000,
    })

    expect(before.visibleTick).toBe(rebased.visibleTick)
    expect(rebased.scrollTop).toBe(68_000)
    expect(
      timelineLogicalVisibleTick({
        originTick: before.visibleTick,
        scrollTop: rebased.scrollTop,
        rowSize: 34,
        viewportSize: 680,
        spanTicks: 10_000,
      }),
    ).toBe(3_740.25)
  })

  it("preserves the fractional logical anchor when responsive CSS changes row pitch", () => {
    // Given a desktop viewport anchored halfway through logical tick 48
    const desktop = {
      originTick: 0,
      scrollTop: (2_000 + 48.5) * 34,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 192,
    }

    // When the same scroller adopts the touch row pitch and viewport height
    const touch = timelineResizePosition({
      ...desktop,
      nextRowSize: 44,
      nextViewportSize: 616,
    })

    // Then its logical top-row anchor is identical and the new pitch owns physical scroll
    expect(touch.visibleTick).toBe(48.5)
    expect(touch.scrollTop).toBe((2_000 + 48.5) * 44)
    expect(
      timelineLogicalVisibleTick({
        originTick: desktop.originTick,
        scrollTop: touch.scrollTop,
        rowSize: 44,
        viewportSize: 616,
        spanTicks: desktop.spanTicks,
      }),
    ).toBe(48.5)
  })

  it("rebases a far long-chart origin into valid rows when a short chart keeps selection zero", () => {
    // Given a million-tick chart rebased around logical tick 3000
    const position = timelineSpanPosition({
      originTick: 3_000,
      scrollTop: 68_000,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 1_000_000,
      nextSpanTicks: 32,
    })

    // When the active document is replaced by a 32-tick chart without changing selection
    const window = timelineVirtualWindow({
      originTick: position.originTick,
      scrollTop: position.scrollTop,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 32,
    })

    // Then the new end anchor is centered and every rendered row belongs to the short chart
    expect(position).toEqual({ originTick: 12, visibleTick: 12, scrollTop: 68_000 })
    expect(window.rows[0]).toBe(0)
    expect(window.rows.at(-1)).toBe(31)
  })

  it("preserves the current logical anchor when the chart span extends", () => {
    const position = timelineSpanPosition({
      originTick: 0,
      scrollTop: (2_000 + 6.5) * 34,
      rowSize: 34,
      viewportSize: 680,
      spanTicks: 32,
      nextSpanTicks: 1_000,
    })

    expect(position).toEqual({
      originTick: 0,
      visibleTick: 6.5,
      scrollTop: (2_000 + 6.5) * 34,
    })
  })
})

it("maps each physical five-panel pad to the repeating blue-red-yellow-red-blue tones", () => {
  expect(Array.from({ length: 10 }, (_, lane) => laneTone(lane))).toEqual([
    "blue",
    "red",
    "yellow",
    "red",
    "blue",
    "blue",
    "red",
    "yellow",
    "red",
    "blue",
  ])
})

it("treats every crossed automatic region cell as read-only for hold gestures", () => {
  const regions = [
    AutomaticRegionViewSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Automatic chorus",
      start_tick: 16,
      end_tick: 24,
    }),
  ]

  expect(timelineRangeIntersectsRegions(12, 20, regions)).toBe(true)
  expect(timelineRangeIntersectsRegions(28, 24, regions)).toBe(false)
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
