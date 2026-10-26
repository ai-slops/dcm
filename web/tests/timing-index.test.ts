import { expect, it } from "vitest"

import type { NativeChart, NativeMusic } from "../shared/index.ts"
import { buildNoteAudioIntervals } from "../src/domain/playback.ts"
import { audioMicrosToTick, tickToAudioMicros } from "../src/domain/timing.ts"

it("does not advance into later tempo segments when a large offset hides sub-microsecond differences", () => {
  const music: NativeMusic = {
    duration_ticks: 32,
    ticks_per_beat: 4,
    offset_micros: 8_000_000_000_000_000,
    audio_sha256: Array.from({ length: 32 }, () => 0),
    reference_accents: [],
    tempo: [
      { start_tick: 0, micros_per_beat: { numerator: 1, denominator: 1_000_000_000_000 } },
      { start_tick: 16, micros_per_beat: { numerator: 1, denominator: 500_000_000_000 } },
    ],
  }
  expect(audioMicrosToTick(music, music.offset_micros)).toBe(0)
})

it("projects the maximum note and tempo profile without rescanning tempo for every note", () => {
  // Given a valid maximum-size profile with observable reads of tempo periods
  let periodReads = 0
  const music: NativeMusic = {
    duration_ticks: 50_000,
    ticks_per_beat: 4,
    offset_micros: 1_001,
    audio_sha256: Array.from({ length: 32 }, () => 0),
    reference_accents: [],
    tempo: Array.from({ length: 4_096 }, (_, index) => ({
      start_tick: index * 10,
      micros_per_beat: {
        get numerator() {
          periodReads += 1
          return index % 2 === 0 ? 500_000 : 400_000
        },
        denominator: 1,
      },
    })),
  }
  const chart: NativeChart = {
    ticks_per_beat: 4,
    span_ticks: 50_000,
    notes: Array.from({ length: 10_000 }, (_, index) => ({
      tick: index * 4,
      panel_mask: 1,
      hold_ticks: 0,
    })),
  }
  // When a chart is projected, then edited without replacing its music revision
  const first = buildNoteAudioIntervals(chart, music)
  const readsAfterInitialProjection = periodReads
  const edited = buildNoteAudioIntervals({ ...chart, notes: chart.notes.slice(1) }, music)
  // Then tempo construction is linear once, and later chart edits reuse that projection
  expect(first).toHaveLength(10_000)
  expect(edited).toHaveLength(9_999)
  expect(readsAfterInitialProjection).toBeLessThanOrEqual(8_192)
  expect(periodReads).toBe(readsAfterInitialProjection)
})

it("preserves forward and inverse times at tempo boundaries and signed offsets", () => {
  // Given independent known times in a two-section native music map
  const music: NativeMusic = {
    duration_ticks: 32,
    ticks_per_beat: 4,
    offset_micros: -1_250,
    audio_sha256: Array.from({ length: 32 }, () => 0),
    reference_accents: [],
    tempo: [
      { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
      { start_tick: 16, micros_per_beat: { numerator: 400_000, denominator: 1 } },
    ],
  }
  // When known boundary and fractional positions are converted
  for (const [tick, micros] of [
    [0, -1_250],
    [16, 1_998_750],
    [17, 2_098_750],
    [19.5, 2_348_750],
    [32, 3_598_750],
  ] as const) {
    // Then both directions match the independent values
    expect(tickToAudioMicros(music, tick)).toBe(micros)
    expect(audioMicrosToTick(music, micros)).toBe(tick)
  }
})
