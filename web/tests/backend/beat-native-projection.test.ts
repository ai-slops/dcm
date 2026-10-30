import { describe, expect, it } from "vitest"

import {
  nativeChartToBeatCore,
  projectBeatChartNative,
} from "../../server/native/beat-projection.ts"
import type { BeatChartCore } from "../../shared/beat.ts"
import type { BeatEvaluationContract } from "../../shared/beat-evaluation.ts"
import {
  nativeEvaluationExtentCapability,
  nativeTicksPerBeatFor,
} from "../../shared/beat-native-capability.ts"

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

  it("ignores imported grid hints when semantic coordinates fit the native grid", () => {
    const result = projectBeatChartNative(
      chart([508, 452]),
      Array.from({ length: 32 }, () => 0),
    )

    expect(result).toMatchObject({
      kind: "supported",
      chart: { ticks_per_beat: 3, notes: [{ tick: 1, hold_ticks: 2 }] },
    })
  })

  it("projects the exclusive automatic region end beyond the final note", () => {
    // Given
    const base = chart([4])
    const source: BeatChartCore = {
      ...base,
      timing: { ...base.timing, duration: null },
      notes: [{ at: beat(3), hold: beat(0), panel_mask: 1 }],
    }

    // When
    const result = projectBeatChartNative(
      source,
      Array.from({ length: 32 }, () => 0),
      {
        automatic_region_ends: [beat(4)],
      },
    )

    // Then
    expect(result).toMatchObject({
      kind: "supported",
      chart: { span_ticks: 4 },
      music: { duration_ticks: 4 },
    })
    expect(source.timing.duration).toBeNull()
  })

  it("projects a region-only automatic chart", () => {
    // Given
    const base = chart([4])
    const source: BeatChartCore = {
      ...base,
      timing: { ...base.timing, duration: null },
      notes: [],
    }

    // When
    const result = projectBeatChartNative(
      source,
      Array.from({ length: 32 }, () => 0),
      {
        automatic_region_ends: [beat(4)],
      },
    )

    // Then
    expect(result).toMatchObject({
      kind: "supported",
      chart: { span_ticks: 4, notes: [] },
      music: { duration_ticks: 4 },
    })
  })

  it("returns a bounded TPB requirement from semantic coordinates without rounding", () => {
    const result = nativeTicksPerBeatFor([beat(1, Number.MAX_SAFE_INTEGER)])

    expect(result).toEqual({
      kind: "unsupported",
      capability: {
        code: "native_grid_unsupported",
        required_tpb: Number.MAX_SAFE_INTEGER.toString(),
        limit: 4_096,
      },
    })
  })

  it("reports evaluation extent as a typed capability without trimming semantics", () => {
    const contract = {
      schema_version: 2,
      history_policy: { recent_window: 0, max_request_history: 0 },
      foot_model: {
        version: 1,
        micros_per_panel_unit: 1,
        bracket_setup_micros: 1,
        crossover_penalty: 0,
        bracket_penalty: 0,
      },
      difficulty: {
        label: "finite",
        density: { minimum: 0, maximum: 1 },
        movement: { minimum: 0, maximum: 1 },
        brackets: { minimum: 0, maximum: 1 },
        hold_occupancy: { minimum: 0, maximum: 1 },
        local_load: { minimum: 0, maximum: 1 },
        total: { minimum: 0, maximum: 1 },
        local_windows: [{ width: beat(3), maximum_load: 1 }],
      },
      intents: [],
      budgets: { max_notes: 10, max_frames: 10, max_dp_work: 10, max_matching_work: 10 },
    } satisfies BeatEvaluationContract

    const capability = nativeEvaluationExtentCapability(contract, beat(2))

    expect(capability).toMatchObject({
      code: "native_evaluation_extent_unsupported",
      field: "difficulty.local_windows[0].width",
      required_end: beat(3),
      duration: beat(2),
    })
    expect(contract.difficulty.local_windows[0]?.width).toEqual(beat(3))
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
