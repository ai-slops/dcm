import { describe, expect, it } from "vitest"

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
  it("requires explicit duration to be after every occupied hold tail", () => {
    // Given a hold whose occupied tail equals the explicit duration
    const result = BeatChartDocumentSchema.safeParse({
      schema_version: 1,
      title: "Tail boundary",
      artist: "Song artist",
      chart_artist: "Stepper",
      mode: "Double",
      timing,
      notes: [{ at: { numerator: 3, denominator: 1 }, hold: one, panel_mask: 1 }],
      audio_sha256: "0".repeat(64),
      audio_asset: { format: "wav", byte_length: 44 },
      evaluation_contract: evaluationContract,
    })

    // When / Then the occupied tail cell cannot equal duration
    expect(result.success).toBe(false)
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

  it("rejects weighted cycles with more than ten thousand analytical slots", () => {
    // Given a cycle with 10,001 exact slots
    const result = GenerationProjectV2Schema.safeParse({
      schema_version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Oversized rules",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Double",
      chart_artist: "Stepper",
      base_ucs_ref: null,
      timing: { ...timing, duration: null },
      evaluation_contract: evaluationContract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start: zero,
        end: { numerator: 10_001, denominator: 1 },
        step: one,
        pattern: [{ choices: [{ panel_mask: 1, hold: zero, weight: 1 }] }],
      },
      applied_components: {},
    })

    // When / Then validation rejects before iterating the slot range
    expect(result.success).toBe(false)
  })

  it("caps hybrid fixed notes plus generated slots at ten thousand", () => {
    // Given 10,000 generated slots plus one fixed note
    const result = GenerationProjectV2Schema.safeParse({
      schema_version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Oversized hybrid",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Double",
      chart_artist: "Stepper",
      base_ucs_ref: null,
      timing: { ...timing, duration: null },
      evaluation_contract: evaluationContract,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [{ at: { numerator: 10_001, denominator: 1 }, hold: zero, panel_mask: 1 }],
        regions: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            name: "Ten thousand slots",
            rules: {
              start: zero,
              end: { numerator: 10_000, denominator: 1 },
              step: one,
              pattern: [{ choices: [{ panel_mask: 2, hold: zero, weight: 1 }] }],
            },
          },
        ],
      },
      applied_components: {},
    })

    // When / Then total demand exceeds the project cap
    expect(result.success).toBe(false)
  })

  it("rejects a generated hold tail on the hybrid region end cell", () => {
    // Given the final generated slot would hold through the exclusive region end
    const result = GenerationProjectV2Schema.safeParse({
      schema_version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Tail at region end",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Double",
      chart_artist: "Stepper",
      base_ucs_ref: null,
      timing,
      evaluation_contract: evaluationContract,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [],
        regions: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            name: "Tail boundary",
            rules: {
              start: zero,
              end: four,
              step: one,
              pattern: [{ choices: [{ panel_mask: 1, hold: one, weight: 1 }] }],
            },
          },
        ],
      },
      applied_components: {},
    })

    // When / Then hybrid holds must end before the region boundary
    expect(result.success).toBe(false)
  })

  it("accepts exact notes independently of imported grid hints", () => {
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
          at: { numerator: 7, denominator: 20 },
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
