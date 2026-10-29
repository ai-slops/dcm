import { describe, expect, it } from "vitest"

import {
  addBeats,
  BaseUcsRefSchema,
  BeatSchema,
  BeatTimingSchema,
  beatFromTicks,
  MAX_EDIT_ROWS_PER_MEASURE,
  MAX_ROWS_PER_MEASURE,
  subtractBeats,
} from "../shared/beat.ts"
import { BeatChartDocumentSchema } from "../shared/beat-projects.ts"

const zero = { numerator: 0, denominator: 1 } as const
const one = { numerator: 1, denominator: 1 } as const
const timing = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [{ at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
  grid_sections: [{ at: zero, rows_per_measure: 192 }],
  duration: { numerator: 4, denominator: 1 },
  reference_accents: [one],
} as const
const evaluationContract = {
  schema_version: 2,
  history_policy: { recent_window: 0, max_request_history: 0 },
  foot_model: {
    version: 1,
    micros_per_panel_unit: 100_000,
    bracket_setup_micros: 100_000,
    crossover_penalty: 2,
    bracket_penalty: 3,
  },
  difficulty: {
    label: "fixture",
    density: { minimum: 0, maximum: 100 },
    movement: { minimum: 0, maximum: 100 },
    brackets: { minimum: 0, maximum: 100 },
    hold_occupancy: { minimum: 0, maximum: 100 },
    local_load: { minimum: 0, maximum: 100 },
    total: { minimum: 0, maximum: 100 },
    local_windows: [{ width: one, maximum_load: 100 }],
  },
  intents: [],
  budgets: {
    max_notes: 10_000,
    max_frames: 10_000,
    max_dp_work: 1_000_000,
    max_matching_work: 1_000_000,
  },
} as const

describe("beat arithmetic contracts", () => {
  it("reduces legacy ticks exactly without using decimal timing", () => {
    // Given / When
    const beat = beatFromTicks(84, 48)

    // Then
    expect(beat).toEqual({ numerator: 7, denominator: 4 })
  })

  it("stores legacy high-resolution grids while keeping the editor split cap separate", () => {
    // Given / When / Then
    expect(BeatSchema.safeParse({ numerator: 2, denominator: 4 }).success).toBe(false)
    expect(MAX_ROWS_PER_MEASURE).toBe(16_384)
    expect(MAX_EDIT_ROWS_PER_MEASURE).toBe(512)
    expect(
      BeatTimingSchema.safeParse({
        ...timing,
        grid_sections: [{ at: zero, rows_per_measure: 4_096 }],
      }).success,
    ).toBe(true)
    expect(
      BeatChartDocumentSchema.safeParse({
        schema_version: 1,
        title: "Fixture",
        artist: "Song artist",
        chart_artist: "Stepper",
        mode: "Double",
        timing: {
          ...timing,
          grid_sections: [{ at: zero, rows_per_measure: MAX_ROWS_PER_MEASURE + 1 }],
        },
        notes: [],
        audio_sha256: "0".repeat(64),
        audio_asset: { format: "wav", byte_length: 44 },
        evaluation_contract: evaluationContract,
      }).success,
    ).toBe(false)
  })

  it("reduces before safe-number conversion for representable large beat arithmetic", () => {
    // Given reduced operands whose cross-products exceed safe integers
    const maximum = Number.MAX_SAFE_INTEGER
    const left = BeatSchema.parse({ numerator: maximum - 1, denominator: maximum })
    const right = BeatSchema.parse({ numerator: 1, denominator: maximum })
    const nearby = BeatSchema.parse({ numerator: maximum - 2, denominator: maximum })

    // When exact shared arithmetic combines them
    const sum = addBeats(left, right)
    const difference = subtractBeats(left, nearby)

    // Then the reduced results remain representable and exact
    expect(sum).toEqual(one)
    expect(difference).toEqual({ numerator: 1, denominator: maximum })
  })

  it("accepts retained timing provenance after its ZIP source is removed", () => {
    // Given / When
    const retained = BaseUcsRefSchema.parse({
      source: "retained_timing",
      song_id: "00000000-0000-4000-8000-000000000002",
    })

    // Then
    expect(retained.source).toBe("retained_timing")
  })
})
