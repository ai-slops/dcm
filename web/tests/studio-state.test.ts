import { describe, expect, it } from "vitest"

import { BeatChartDocumentSchema, RevisionSchema } from "../shared/index.ts"
import { reconcileAppliedDocument } from "../src/ui/studio-state.ts"

const zero = { numerator: 0, denominator: 1 } as const

function project(title: string) {
  return BeatChartDocumentSchema.parse({
    schema_version: 1,
    title,
    artist: "PUMP",
    chart_artist: null,
    mode: "Double",
    timing: {
      schema_version: 1,
      offset_micros: 0,
      tempo: [{ at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      grid_sections: [{ at: zero, rows_per_measure: 16 }],
      duration: { numerator: 8, denominator: 1 },
      reference_accents: [],
    },
    notes: [],
    audio_sha256: "0".repeat(64),
    audio_asset: { format: "wav", byte_length: 44 },
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
  })
}

describe("reconcileAppliedDocument", () => {
  it("uses the applied beat document as the visible project and persisted baseline", () => {
    // Given an unchanged beat draft while a proposal is applying
    const original = project("Original")
    const applied = project("Applied")

    // When the server returns the applied document
    const result = reconcileAppliedDocument({
      startedFromProject: original,
      currentProject: original,
      document: { revision: RevisionSchema.parse(2), project: applied },
    })

    // Then the applied project is clean and undo retains the prior project
    expect(result).toEqual({
      project: applied,
      persistedProject: applied,
      historyProject: original,
      revision: 2,
    })
  })

  it("preserves a newer manual beat draft while advancing the persisted baseline", () => {
    // Given a manual edit made while a proposal request is in flight
    const original = project("Original")
    const manualDraft = project("Manual draft")
    const applied = project("Applied")

    // When the server returns the applied document
    const result = reconcileAppliedDocument({
      startedFromProject: original,
      currentProject: manualDraft,
      document: { revision: RevisionSchema.parse(2), project: applied },
    })

    // Then the manual draft remains visible and dirty against the server document
    expect(result).toEqual({
      project: manualDraft,
      persistedProject: applied,
      historyProject: null,
      revision: 2,
    })
  })
})
