import { expect, it } from "vitest"

import {
  BeatChartDocumentSchema,
  type GenerationProjectV2,
  GenerationProjectV2Schema,
} from "../shared/beat-projects.ts"
import {
  beatTemplateJson,
  initialBeatProjectJson,
  parseBeatProjectForm,
} from "../src/ui/project-form.ts"

function project(): GenerationProjectV2 {
  return GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    name: "Beat project",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Single",
    chart_artist: "Stepper",
    base_ucs_ref: {
      source: "saved_chart",
      chart_id: "00000000-0000-4000-8000-000000000003",
    },
    timing: {
      schema_version: 1,
      offset_micros: -125_000,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 1_000_001, denominator: 2 },
        },
      ],
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 127 }],
      duration: null,
      reference_accents: [],
    },
    evaluation_contract: {
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
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [],
    },
    applied_components: {},
  })
}

it("preserves exact beat timing without exposing compatibility metadata", () => {
  // Given
  const source = project()
  const json = initialBeatProjectJson(source)

  // When
  const parsed = parseBeatProjectForm({
    name: source.name,
    mode: source.mode,
    ...json,
  })

  // Then
  expect(parsed.timing).toEqual(source.timing)
  expect(parsed.timing.grid_sections[0]?.rows_per_measure).toBe(127)
  expect(parsed.timing.tempo[0]?.micros_per_beat).toEqual({
    numerator: 1_000_001,
    denominator: 2,
  })
})

it("keeps automatic duration without requiring artist input", () => {
  // Given
  const source = project()
  const json = initialBeatProjectJson(source)

  // When
  const parsed = parseBeatProjectForm({
    name: source.name,
    mode: source.mode,
    ...json,
  })

  // Then
  expect(parsed.timing.duration).toBeNull()
})

it("starts a new project with automatic duration while preserving the chosen timing basis", () => {
  // Given
  const source = project()
  const template = BeatChartDocumentSchema.parse({
    schema_version: 1,
    title: "Song",
    artist: "Song artist",
    chart_artist: "Source author",
    mode: source.mode,
    timing: { ...source.timing, duration: { numerator: 8, denominator: 1 } },
    notes: [],
    audio_sha256: "0".repeat(64),
    audio_asset: { format: "wav", byte_length: 0 },
    evaluation_contract: source.evaluation_contract,
  })

  // When
  const json = beatTemplateJson(template)
  const timing = JSON.parse(json.timing)

  // Then
  expect(timing).toEqual({ ...template.timing, duration: null })
})
