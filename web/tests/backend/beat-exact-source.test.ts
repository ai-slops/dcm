import { describe, expect, it } from "vitest"

import { GenerationProjectV2Schema } from "../../shared/beat-projects.ts"

const zero = { numerator: 0, denominator: 1 } as const

describe("beat exact source contracts", () => {
  it("accepts exact generation slots and holds independently of imported grid hints", () => {
    const result = GenerationProjectV2Schema.safeParse({
      schema_version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Exact rules",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Single",
      chart_artist: null,
      base_ucs_ref: null,
      timing: {
        schema_version: 1,
        offset_micros: 0,
        tempo: [{ at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        grid_sections: [{ at: zero, rows_per_measure: 16 }],
        duration: { numerator: 4, denominator: 1 },
        reference_accents: [],
      },
      evaluation_contract: {
        schema_version: 2,
        history_policy: { recent_window: 0, max_request_history: 0 },
        foot_model: {
          version: 1,
          micros_per_panel_unit: 100_000,
          bracket_setup_micros: 100_000,
          crossover_penalty: 0,
          bracket_penalty: 0,
        },
        difficulty: {
          label: "fixture",
          density: { minimum: 0, maximum: 100 },
          movement: { minimum: 0, maximum: 100 },
          brackets: { minimum: 0, maximum: 100 },
          hold_occupancy: { minimum: 0, maximum: 100 },
          local_load: { minimum: 0, maximum: 100 },
          total: { minimum: 0, maximum: 100 },
          local_windows: [],
        },
        intents: [],
        budgets: {
          max_notes: 10_000,
          max_frames: 10_000,
          max_dp_work: 1_000_000,
          max_matching_work: 1_000_000,
        },
      },
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start: { numerator: 1, denominator: 3 },
        end: { numerator: 7, denominator: 3 },
        step: { numerator: 1, denominator: 3 },
        pattern: [
          {
            choices: [{ panel_mask: 1, hold: { numerator: 1, denominator: 6 }, weight: 1 }],
          },
        ],
      },
      applied_components: {},
    })

    expect(result.success).toBe(true)
  })
})
