import { describe, expect, it } from "vitest"

import {
  nativeChartToBeatCore,
  projectBeatChartNative,
} from "../../server/native/beat-projection.ts"
import type { BeatChartCore } from "../../shared/beat.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

function chart(rows: readonly number[]): BeatChartCore {
  return {
    mode: "Single",
    timing: {
      schema_version: 1,
      offset_micros: 0,
      tempo: [{ at: beat(0), micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      grid_sections: rows.map((rows_per_measure, index) => ({
        at: index === 0 ? beat(0) : beat(1),
        rows_per_measure,
      })),
      duration: beat(2),
      reference_accents: [],
    },
    notes: [{ at: beat(1, 3), hold: beat(2, 3), panel_mask: 1 }],
  }
}

describe("beat native projection", () => {
  it("preserves exact beat coordinates when the native grid is supported", () => {
    const result = projectBeatChartNative(
      chart([12]),
      Array.from({ length: 32 }, () => 7),
    )

    expect(result).toMatchObject({
      kind: "supported",
      chart: { ticks_per_beat: 3, notes: [{ tick: 1, hold_ticks: 2 }] },
      music: { duration_ticks: 6, ticks_per_beat: 3 },
    })
  })

  it("returns typed unsupported capability instead of rounding a coprime local grid", () => {
    const result = projectBeatChartNative(
      chart([508, 452]),
      Array.from({ length: 32 }, () => 0),
    )

    expect(result).toEqual({
      kind: "unsupported",
      capability: { code: "native_grid_unsupported", required_tpb: "43053", limit: 4_096 },
    })
  })

  it("decodes a native result to reduced beats and concretizes automatic duration", () => {
    const source = chart([12])
    const result = nativeChartToBeatCore(
      {
        ticks_per_beat: 3,
        span_ticks: 6,
        notes: [{ tick: 1, hold_ticks: 2, panel_mask: 1 }],
      },
      source.mode,
      { ...source.timing, duration: null },
    )

    expect(result.timing.duration).toEqual({ numerator: 2, denominator: 1 })
    expect(result.notes).toEqual([
      {
        at: { numerator: 1, denominator: 3 },
        hold: { numerator: 2, denominator: 3 },
        panel_mask: 1,
      },
    ])
  })
})
