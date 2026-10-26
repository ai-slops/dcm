import { describe, expect, it } from "vitest"

import { RevisionSchema, StudioProjectV1Schema } from "../shared/index.ts"
import { editorStateForReplacement, reconcileAppliedDocument } from "../src/ui/studio-state.ts"

function project(title: string) {
  return StudioProjectV1Schema.parse({
    schema_version: 1,
    title,
    artist: "PUMP",
    music: {
      duration_ticks: 32,
      ticks_per_beat: 4,
      offset_micros: 0,
      tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      audio_sha256: Array.from({ length: 32 }, () => 0),
      reference_accents: [],
    },
    chart: { ticks_per_beat: 4, span_ticks: 32, notes: [] },
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
  })
}

describe("reconcileAppliedDocument", () => {
  it("uses the applied server document as both the visible project and persisted baseline", () => {
    // Given an unchanged draft while a proposal is applying
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
    expect(JSON.stringify(result.historyProject)).not.toBe(JSON.stringify(result.persistedProject))
  })

  it("preserves a newer manual draft while advancing the persisted baseline", () => {
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

    // Then the manual draft remains visible and dirty against the actual server document
    expect(result).toEqual({
      project: manualDraft,
      persistedProject: applied,
      historyProject: null,
      revision: 2,
    })
  })
})

describe("replacement editor state", () => {
  it("resets a short imported chart to one valid tick and the new hold grid", () => {
    // Given an imported project whose timing grid differs from the prior editor state
    const imported = project("Imported")
    const replacement = {
      ...imported,
      music: { ...imported.music, ticks_per_beat: 8 },
      chart: { ...imported.chart, ticks_per_beat: 8, span_ticks: 12 },
    }

    // When replacement editor state is derived from the imported document
    const state = editorStateForReplacement(replacement)

    // Then every cursor/window value starts in range with one-tick quantization
    expect(state).toEqual({ tick: 0, lane: 0, holdTicks: 8, quantize: 1, windowStart: 0 })
  })
})
