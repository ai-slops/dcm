import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { canonicalizeChart, EvalContractSchema, StudioProjectV1Schema } from "../shared/index.ts"
import { repoRoot } from "./support/paths.ts"

describe("canonicalizeChart", () => {
  it("merges panel masks when tick and hold duration match", () => {
    // Given
    const chart = {
      ticks_per_beat: 4,
      span_ticks: 32,
      notes: [
        { tick: 8, panel_mask: 2, hold_ticks: 0 },
        { tick: 8, panel_mask: 1, hold_ticks: 0 },
      ],
    }

    // When
    const result = canonicalizeChart(chart)

    // Then
    expect(result.notes).toEqual([{ tick: 8, panel_mask: 3, hold_ticks: 0 }])
  })
})

describe("StudioProjectV1Schema", () => {
  it("rejects a chart whose span differs from the music", () => {
    // Given
    const project = {
      schema_version: 1,
      title: "Fixture",
      artist: "PUMP",
      music: {
        duration_ticks: 32,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        audio_sha256: Array.from({ length: 32 }, () => 0),
        reference_accents: [],
      },
      chart: { ticks_per_beat: 4, span_ticks: 16, notes: [] },
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
      audio_asset: { format: "wav", byte_length: 44 },
    }

    // When
    const result = StudioProjectV1Schema.safeParse(project)

    // Then
    expect(result.success).toBe(false)
  })
})

describe("EvalContractSchema", () => {
  it("rejects more intents than the native matching-work budget", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const contract = {
      ...demo.document.project.evaluation_contract,
      intents: ["first", "second", "third"].map((id) => ({
        id,
        kind: { kind: "reference_accents" as const, tolerance_ticks: 0 },
        requiredness: "required" as const,
        credit_policy: "shared" as const,
        threshold: 1,
        weight: 1,
      })),
      budgets: {
        ...demo.document.project.evaluation_contract.budgets,
        max_matching_work: 1,
      },
    }

    // When
    const result = EvalContractSchema.safeParse(contract)

    // Then
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["intents"])
  })
})
