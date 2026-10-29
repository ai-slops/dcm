import { describe, expect, it } from "vitest"

import { BeatSchema, beatFromTicks } from "../shared/beat.ts"
import {
  BeatChartDocumentSchema,
  GenerationProjectV2Schema,
  NoteFragmentV1Schema,
} from "../shared/beat-projects.ts"

const zero = { numerator: 0, denominator: 1 } as const
const one = { numerator: 1, denominator: 1 } as const
const four = { numerator: 4, denominator: 1 } as const

const timing = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [{ at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
  grid_sections: [{ at: zero, rows_per_measure: 192 }],
  duration: four,
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

describe("beat-native contracts", () => {
  it("reduces legacy ticks exactly without using decimal timing", () => {
    // Given / When
    const beat = beatFromTicks(84, 48)

    // Then
    expect(beat).toEqual({ numerator: 7, denominator: 4 })
  })

  it("rejects unreduced beats and grid subdivisions outside 1 through 512", () => {
    // Given / When / Then
    expect(BeatSchema.safeParse({ numerator: 2, denominator: 4 }).success).toBe(false)
    expect(
      BeatChartDocumentSchema.safeParse({
        schema_version: 1,
        title: "Fixture",
        artist: "Song artist",
        chart_artist: "Stepper",
        mode: "Double",
        timing: { ...timing, grid_sections: [{ at: zero, rows_per_measure: 513 }] },
        notes: [],
        audio_sha256: "0".repeat(64),
        audio_asset: { format: "wav", byte_length: 44 },
        evaluation_contract: evaluationContract,
      }).success,
    ).toBe(false)
  })

  it("parses a beat-native generation project while preserving weighted_cycle_v1", () => {
    // Given
    const project = {
      schema_version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Rules",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Single",
      chart_artist: "Stepper",
      base_ucs_ref: null,
      timing,
      evaluation_contract: evaluationContract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start: zero,
        end: four,
        step: one,
        pattern: [{ choices: [{ panel_mask: 1, hold: zero, weight: 1 }] }],
      },
      applied_components: {},
    }

    // When
    const parsed = GenerationProjectV2Schema.parse(project)

    // Then
    expect(parsed.generation_rules.algorithm).toBe("weighted_cycle_v1")
  })

  it("keeps note fragments relative and independent of tempo", () => {
    // Given
    const fragment = {
      schema_version: 1,
      kind: "note_fragment_v1",
      mode: "Single",
      span: four,
      notes: [{ at: one, hold: one, panel_mask: 1 }],
    }

    // When
    const parsed = NoteFragmentV1Schema.parse(fragment)

    // Then
    expect(parsed.notes[0]?.at).toEqual(one)
    expect(parsed).not.toHaveProperty("ticks_per_beat")
  })

  it("aligns notes to each section origin instead of a global row grid", () => {
    // Given
    const sectionTiming = {
      ...timing,
      grid_sections: [
        { at: zero, rows_per_measure: 16 },
        { at: { numerator: 1, denominator: 4 }, rows_per_measure: 12 },
      ],
      duration: one,
      reference_accents: [],
    }

    // When
    const result = BeatChartDocumentSchema.safeParse({
      schema_version: 1,
      title: "Section-local",
      artist: "Song artist",
      chart_artist: "Stepper",
      mode: "Double",
      timing: sectionTiming,
      notes: [
        {
          at: { numerator: 7, denominator: 12 },
          hold: zero,
          panel_mask: 1,
        },
      ],
      audio_sha256: "0".repeat(64),
      audio_asset: { format: "wav", byte_length: 44 },
      evaluation_contract: evaluationContract,
    })

    // Then
    expect(result.success).toBe(true)
  })

  it("rejects a section boundary that cannot be reached on the preceding section grid", () => {
    // Given / When
    const result = BeatChartDocumentSchema.safeParse({
      schema_version: 1,
      title: "Broken boundary",
      artist: "Song artist",
      chart_artist: "Stepper",
      mode: "Double",
      timing: {
        ...timing,
        grid_sections: [
          { at: zero, rows_per_measure: 16 },
          { at: { numerator: 1, denominator: 3 }, rows_per_measure: 12 },
        ],
      },
      notes: [],
      audio_sha256: "0".repeat(64),
      audio_asset: { format: "wav", byte_length: 44 },
      evaluation_contract: evaluationContract,
    })

    // Then
    expect(result.success).toBe(false)
  })
})
