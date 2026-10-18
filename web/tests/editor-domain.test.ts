import { describe, expect, it } from "vitest"
import type { NativeChart, NativeMusic } from "../shared/index.ts"
import {
  canApplyProposal,
  editPanelAtTick,
  findPanelDemand,
  updatePanelDemand,
} from "../src/domain/editor.ts"
import { audioMicrosToTick, tickToAudioMicros } from "../src/domain/timing.ts"

const chart: NativeChart = {
  ticks_per_beat: 4,
  span_ticks: 32,
  notes: [{ tick: 8, panel_mask: 3, hold_ticks: 0 }],
}

const music: NativeMusic = {
  duration_ticks: 32,
  ticks_per_beat: 4,
  offset_micros: 100_000,
  tempo: [
    { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
    { start_tick: 8, micros_per_beat: { numerator: 400_000, denominator: 1 } },
  ],
  audio_sha256: Array.from({ length: 32 }, () => 0),
  reference_accents: [],
}

describe("editPanelAtTick", () => {
  it("preserves the other panel when erasing one bit from a grouped tap", () => {
    // Given a grouped left-down-left and left-up-left tap
    // When the left-down-left panel is erased
    const edited = editPanelAtTick(chart, { tick: 8, panel: 0, holdTicks: 0, action: "erase" })

    // Then the left-up-left panel remains at the same tick
    expect(edited.notes).toEqual([{ tick: 8, panel_mask: 2, hold_ticks: 0 }])
  })

  it("merges a placed panel with a tap at the same tick", () => {
    // Given a grouped tap
    // When another panel is placed at its tick
    const edited = editPanelAtTick(chart, { tick: 8, panel: 2, holdTicks: 0, action: "place" })

    // Then the result remains one canonical grouped note
    expect(edited.notes).toEqual([{ tick: 8, panel_mask: 7, hold_ticks: 0 }])
  })

  it("is idempotent when placing the same panel demand twice", () => {
    // Given an existing panel demand
    // When the same tap is placed again
    const edited = editPanelAtTick(chart, { tick: 8, panel: 0, holdTicks: 0, action: "place" })

    // Then canonicalization does not create an overlapping duplicate
    expect(edited).toEqual(chart)
  })

  it("erases a hold by panel occupancy without matching its duration", () => {
    // Given a grouped hold occupying tick 10
    const holdChart: NativeChart = {
      ...chart,
      notes: [{ tick: 8, panel_mask: 3, hold_ticks: 4 }],
    }

    // When one occupied panel is erased from inside the hold body
    const edited = editPanelAtTick(holdChart, {
      tick: 10,
      panel: 0,
      holdTicks: 0,
      action: "erase",
    })

    // Then only that panel is removed and the grouped hold remains valid
    expect(edited.notes).toEqual([{ tick: 8, panel_mask: 2, hold_ticks: 4 }])
  })

  it("rejects placing a demand over an active hold", () => {
    // Given a hold occupying the panel through tick 11
    const holdChart: NativeChart = {
      ...chart,
      notes: [{ tick: 8, panel_mask: 1, hold_ticks: 4 }],
    }

    // When a tap is placed inside that occupied interval
    const placeOverlap = () =>
      editPanelAtTick(holdChart, { tick: 10, panel: 0, holdTicks: 0, action: "place" })

    // Then the invalid overlap is rejected
    expect(placeOverlap).toThrow("panel demands overlap")
  })
})

describe("piecewise tempo conversion", () => {
  it("converts through a tempo boundary and honors positive chart offset", () => {
    // Given a chart that starts 100 ms after the audio and changes tempo at tick 8
    // When tick 12 is converted to audio time
    const micros = tickToAudioMicros(music, 12)

    // Then two beats at 120 BPM and one beat at 150 BPM have elapsed after the offset
    expect(micros).toBe(1_500_000)
  })

  it("inverts audio time to a fractional chart tick", () => {
    // Given audio time after the second tempo segment begins
    // When it is converted back to chart position
    const tick = audioMicrosToTick(music, 1_300_000)

    // Then it lands halfway through the segment's first beat
    expect(tick).toBe(10)
  })
})

describe("selected panel demand editing", () => {
  it("finds a hold from a tick inside its occupied interval", () => {
    // Given a hold spanning ticks 8 through 11
    const holdChart: NativeChart = {
      ...chart,
      notes: [{ tick: 8, panel_mask: 1, hold_ticks: 4 }],
    }

    // When the panel demand is selected from its body
    const selected = findPanelDemand(holdChart, 10, 0)

    // Then the hold head and duration are returned
    expect(selected).toEqual({ tick: 8, panel_mask: 1, hold_ticks: 4 })
  })

  it("moves one panel out of a grouped hold while preserving the other panel", () => {
    // Given a grouped hold
    const holdChart: NativeChart = {
      ...chart,
      notes: [{ tick: 8, panel_mask: 3, hold_ticks: 4 }],
    }

    // When one panel is moved and shortened
    const edited = updatePanelDemand(holdChart, {
      sourceTick: 10,
      sourcePanel: 0,
      tick: 16,
      panel: 2,
      holdTicks: 2,
    })

    // Then the grouped peer remains and the moved demand is canonical
    expect(edited.notes).toEqual([
      { tick: 8, panel_mask: 2, hold_ticks: 4 },
      { tick: 16, panel_mask: 4, hold_ticks: 2 },
    ])
  })
})

describe("canApplyProposal", () => {
  it("requires a clean draft at the proposal base revision", () => {
    // Given clean, dirty, and stale proposal states
    // When eligibility is checked
    // Then only the clean current proposal is applicable
    expect(canApplyProposal({ dirty: false, currentRevision: 4, baseRevision: 4 })).toBe(true)
    expect(canApplyProposal({ dirty: true, currentRevision: 4, baseRevision: 4 })).toBe(false)
    expect(canApplyProposal({ dirty: false, currentRevision: 5, baseRevision: 4 })).toBe(false)
  })
})
