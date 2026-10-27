import { describe, expect, it } from "vitest"

import { GenerationProjectSchema } from "../shared/generation-projects.ts"
import { HybridRulesSchema, WeightedCycleRulesSchema } from "../shared/generation-rules.ts"
import {
  convertWeightedCycleToHybrid,
  extendProjectTail,
  fixedChartForProject,
  parseProjectEditPath,
} from "../src/domain/project-grid.ts"

const projectId = "00000000-0000-4000-8000-000000000001"
const songId = "00000000-0000-4000-8000-000000000002"

function project() {
  return GenerationProjectSchema.parse({
    schema_version: 1,
    id: projectId,
    revision: 4,
    name: "Hybrid authoring",
    song_id: songId,
    mode: "Double",
    applied_components: {},
    timing: {
      duration_ticks: 64,
      ticks_per_beat: 4,
      offset_micros: 125_000,
      tempo: [
        { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
        { start_tick: 32, micros_per_beat: { numerator: 1_000_001, denominator: 2 } },
      ],
      reference_accents: [8, 32],
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
        density: { minimum: 0, maximum: 1_000_000 },
        movement: { minimum: 0, maximum: 1_000_000 },
        brackets: { minimum: 0, maximum: 1_000_000 },
        hold_occupancy: { minimum: 0, maximum: 1_000_000 },
        local_load: { minimum: 0, maximum: 1_000_000 },
        total: { minimum: 0, maximum: 1_000_000 },
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
      fixed_notes: [{ tick: 4, panel_mask: 1, hold_ticks: 0 }],
      regions: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Verse",
          rules: {
            start_tick: 16,
            end_tick: 32,
            step_ticks: 4,
            pattern: [{ choices: [{ panel_mask: 2, hold_ticks: 0, weight: 1 }] }],
          },
        },
      ],
    },
  })
}

describe("project grid route", () => {
  it("accepts only the canonical UUID edit route", () => {
    // Given / When / Then
    expect(parseProjectEditPath(`/projects/${projectId}/edit`)).toBe(projectId)
    expect(parseProjectEditPath("/projects/../../etc/passwd/edit")).toBeNull()
  })
})

describe("legacy conversion", () => {
  it("wraps the exact V1 cycle in one user-named region", () => {
    // Given
    const legacy = WeightedCycleRulesSchema.parse({
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 8,
      end_tick: 40,
      step_ticks: 4,
      pattern: [{ choices: [{ panel_mask: 3, hold_ticks: 0, weight: 2 }] }],
    })

    // When
    const converted = convertWeightedCycleToHybrid(legacy, {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Imported cycle",
    })

    // Then
    expect(HybridRulesSchema.parse(converted)).toEqual({
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          name: "Imported cycle",
          rules: {
            start_tick: 8,
            end_tick: 40,
            step_ticks: 4,
            pattern: [{ choices: [{ panel_mask: 3, hold_ticks: 0, weight: 2 }] }],
          },
        },
      ],
    })
  })
})

describe("exact project timing", () => {
  it("extends only duration and chart span when no tail BPM is supplied", () => {
    // Given
    const original = project()

    // When
    const result = extendProjectTail(original, { additionalTicks: "16", tailBpm: "" })

    // Then
    expect(result.kind).toBe("success")
    if (result.kind === "success") {
      expect(result.project.timing).toEqual({ ...original.timing, duration_ticks: 80 })
      expect(result.project.generation_rules).toEqual(original.generation_rules)
      expect(fixedChartForProject(result.project)).toMatchObject({ span_ticks: 80 })
    }
  })

  it("adds one exact tempo marker at the old end only when BPM differs", () => {
    // Given
    const original = project()

    // When
    const changed = extendProjectTail(original, { additionalTicks: "16", tailBpm: "123.45" })
    const exactBaseOnly = GenerationProjectSchema.parse({
      ...original,
      timing: { ...original.timing, tempo: original.timing.tempo.slice(0, 1) },
    })
    const unchanged = extendProjectTail(exactBaseOnly, { additionalTicks: "16", tailBpm: "120" })

    // Then
    expect(changed.kind).toBe("success")
    if (changed.kind === "success") {
      expect(changed.project.timing.tempo.at(-1)).toEqual({
        start_tick: 64,
        micros_per_beat: { numerator: 400_000_000, denominator: 823 },
      })
    }
    expect(unchanged.kind).toBe("success")
    if (unchanged.kind === "success") {
      expect(unchanged.project.timing.tempo).toEqual(exactBaseOnly.timing.tempo)
    }
  })

  it("rejects non-positive extension without mutating the draft", () => {
    // Given
    const original = project()
    const before = JSON.stringify(original)

    // When
    const result = extendProjectTail(original, { additionalTicks: "0", tailBpm: "" })

    // Then
    expect(result).toMatchObject({ kind: "error" })
    expect(JSON.stringify(original)).toBe(before)
  })
})
