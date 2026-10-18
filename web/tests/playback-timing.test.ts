import { describe, expect, it } from "vitest"
import type { NativeChart, NativeMusic } from "../shared/index.ts"
import {
  activePanelMaskAtAudioMicros,
  activePanelMaskAtSelectedTick,
  chartTickAtAudioMicros,
} from "../src/domain/playback.ts"

const music: NativeMusic = {
  duration_ticks: 16,
  ticks_per_beat: 4,
  offset_micros: 100_000,
  tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
  audio_sha256: Array.from({ length: 32 }, () => 1),
  reference_accents: [],
}

describe("playback clock boundaries", () => {
  it("keeps the playhead absent before a positive chart offset", () => {
    // Given a chart whose first tick starts 100 ms into the audio
    // When the audio clock is one microsecond before that offset
    const tick = chartTickAtAudioMicros(music, 99_999)

    // Then no future chart tick is painted early
    expect(tick).toBeNull()
  })

  it("releases a hold at its exclusive tail", () => {
    // Given a four-tick hold starting at tick zero
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 16,
      notes: [{ tick: 0, panel_mask: 1, hold_ticks: 4 }],
    }

    // When the audio clock reaches the exact tail time
    const mask = activePanelMaskAtAudioMicros(chart, music, 600_000)

    // Then the panel is no longer active
    expect(mask).toBe(0)
  })

  it("shows a tap only for the documented 120 ms pulse after its onset", () => {
    // Given a tap at the first chart tick
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 16,
      notes: [{ tick: 0, panel_mask: 4, hold_ticks: 0 }],
    }

    // When sampling immediately before and at the pulse boundary
    const duringPulse = activePanelMaskAtAudioMicros(chart, music, 219_999)
    const afterPulse = activePanelMaskAtAudioMicros(chart, music, 220_000)

    // Then the pulse is active only inside the half-open interval
    expect(duringPulse).toBe(4)
    expect(afterPulse).toBe(0)
  })

  it("ORs same-tick groups while respecting their different hold tails", () => {
    // Given two same-tick groups with different durations
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 16,
      notes: [
        { tick: 0, panel_mask: 1, hold_ticks: 4 },
        { tick: 0, panel_mask: 2, hold_ticks: 8 },
      ],
    }

    // When sampling at the shorter group's exclusive tail
    const mask = activePanelMaskAtAudioMicros(chart, music, 600_000)

    // Then only the longer group remains active
    expect(mask).toBe(2)
  })
})

describe("stopped selected-tick preview", () => {
  it("highlights a tap only at its exact selected tick", () => {
    // Given a tap at tick four
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 16,
      notes: [{ tick: 4, panel_mask: 8, hold_ticks: 0 }],
    }

    // When adjacent and exact ticks are selected
    const before = activePanelMaskAtSelectedTick(chart, 3.999)
    const exact = activePanelMaskAtSelectedTick(chart, 4)

    // Then static selection uses exact tap semantics
    expect(before).toBe(0)
    expect(exact).toBe(8)
  })
})
