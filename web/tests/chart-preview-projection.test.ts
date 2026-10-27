import { describe, expect, it } from "vitest"

import type { NativeChart, NativeMusic } from "../shared/index.ts"
import { buildChartPreviewIndex, projectVisibleContacts } from "../src/domain/chart-preview.ts"

const music: NativeMusic = {
  duration_ticks: 24,
  ticks_per_beat: 4,
  offset_micros: 100_000,
  tempo: [
    { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
    { start_tick: 8, micros_per_beat: { numerator: 1_000_000, denominator: 1 } },
  ],
  audio_sha256: Array.from({ length: 32 }, () => 7),
  reference_accents: [],
}

describe("scrolling chart preview projection", () => {
  it("reuses a precomputed timing index across media-clock samples", () => {
    // Given chart contacts projected to audio time once
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 24,
      notes: [
        { tick: 0, panel_mask: 1, hold_ticks: 12 },
        { tick: 16, panel_mask: 2, hold_ticks: 0 },
      ],
    }
    const index = buildChartPreviewIndex(chart, music)

    // When two requestAnimationFrame samples query distant bounded windows
    const early = projectVisibleContacts({
      index,
      audioMicros: 1_200_000,
      pastMicros: 100_000,
      lookaheadMicros: 250_000,
      contactCap: 8,
    })
    const late = projectVisibleContacts({
      index,
      audioMicros: 3_100_000,
      pastMicros: 100_000,
      lookaheadMicros: 250_000,
      contactCap: 8,
    })

    // Then the earlier long hold and later tap are found without rebuilding timing data
    expect(early.contacts.map((contact) => contact.tick)).toEqual([0])
    expect(late.contacts.map((contact) => contact.tick)).toEqual([16])
  })

  it("projects chord lanes and an exact piecewise hold tail from audio time", () => {
    // Given a chorded hold that crosses a tempo change
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 24,
      notes: [{ tick: 6, panel_mask: 0b1000000001, hold_ticks: 6 }],
    }

    // When the media clock is sampled before the hold onset
    const projection = projectVisibleContacts({
      index: buildChartPreviewIndex(chart, music),
      audioMicros: 700_000,
      pastMicros: 250_000,
      lookaheadMicros: 2_000_000,
      contactCap: 16,
    })

    // Then both chord contacts share the onset and retain the tempo-aware tail
    expect(projection.contacts).toHaveLength(2)
    expect(projection.contacts.map((contact) => contact.lane)).toEqual([0, 9])
    expect(projection.contacts[0]).toMatchObject({
      kind: "hold",
      headMicros: 850_000,
      tailMicros: 2_100_000,
    })
    expect(projection.hiddenContactCount).toBe(0)
  })

  it("returns a deterministic bounded window with truthful overflow", () => {
    // Given more upcoming contacts than the renderer cap
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 24,
      notes: [
        { tick: 1, panel_mask: 0b0000000011, hold_ticks: 0 },
        { tick: 2, panel_mask: 0b0000001100, hold_ticks: 0 },
        { tick: 3, panel_mask: 0b0000110000, hold_ticks: 0 },
      ],
    }

    // When only three visible contacts may be returned
    const projection = projectVisibleContacts({
      index: buildChartPreviewIndex(chart, music),
      audioMicros: 100_000,
      pastMicros: 0,
      lookaheadMicros: 1_000_000,
      contactCap: 3,
    })

    // Then onset/lane order is stable and omitted contacts are disclosed
    expect(projection.contacts.map((contact) => [contact.tick, contact.lane])).toEqual([
      [1, 0],
      [1, 1],
      [2, 2],
    ])
    expect(projection.hiddenContactCount).toBe(3)
  })

  it("keeps a hold visible after its head leaves the past window", () => {
    // Given a hold whose body still intersects the playfield window
    const chart: NativeChart = {
      ticks_per_beat: 4,
      span_ticks: 24,
      notes: [{ tick: 0, panel_mask: 1, hold_ticks: 12 }],
    }

    // When the clock has moved beyond the head but not the exclusive tail
    const projection = projectVisibleContacts({
      index: buildChartPreviewIndex(chart, music),
      audioMicros: 1_200_000,
      pastMicros: 100_000,
      lookaheadMicros: 750_000,
      contactCap: 8,
    })

    // Then the intersecting hold remains renderable
    expect(projection.contacts).toHaveLength(1)
    expect(projection.contacts[0]?.kind).toBe("hold")
  })
})
