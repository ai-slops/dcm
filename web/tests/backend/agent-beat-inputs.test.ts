import { describe, expect, it } from "vitest"

import {
  ApplyComponentInput,
  CreateProjectInput,
  PublishComponentInput,
  WriteProjectInput,
} from "../../server/agent/project-tool-schemas.ts"
import { fullProject } from "../support/agent-project-fixtures.ts"

describe("beat-native agent project inputs", () => {
  it("accepts exact beat authoring with an explicit base source when creating a project", () => {
    // Given
    const project = fullProject()
    const input = {
      name: project.name,
      song_id: project.song_id,
      mode: project.mode,
      chart_artist: "Chart author",
      base_ucs_ref: {
        source: "saved_chart",
        chart_id: "00000000-0000-4000-8000-000000000003",
      },
      timing: project.timing,
      evaluation_contract: project.evaluation_contract,
      generation_rules: project.generation_rules,
    }

    // When
    const result = CreateProjectInput.safeParse(input)

    // Then
    expect(result.success).toBe(true)
  })

  it("rejects a global-tick authoring replacement when writing a project", () => {
    // Given
    const project = fullProject()

    // When
    const result = WriteProjectInput.safeParse({
      project_id: project.id,
      base_revision: project.revision,
      name: project.name,
      chart_artist: project.chart_artist,
      timing: {
        duration_ticks: 96,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        reference_accents: [],
      },
      evaluation_contract: project.evaluation_contract,
      generation_rules: project.generation_rules,
    })

    // Then
    expect(result.success).toBe(false)
  })

  it("does not require guessed authorship metadata for project creation", () => {
    const project = fullProject()
    const parsed = CreateProjectInput.parse({
      name: project.name,
      song_id: project.song_id,
      mode: project.mode,
      base_ucs_ref: { source: "saved_chart", chart_id: "00000000-0000-4000-8000-000000000003" },
      timing: project.timing,
      evaluation_contract: project.evaluation_contract,
      generation_rules: project.generation_rules,
    })

    expect(parsed.chart_artist).toBeNull()
  })

  it("accepts a beat range when publishing a note fragment", () => {
    // Given
    const project = fullProject()

    // When
    const result = PublishComponentInput.safeParse({
      project_id: project.id,
      base_revision: project.revision,
      kind: "note_fragment",
      name: "Cross-tempo phrase",
      start: { numerator: 0, denominator: 1 },
      end: { numerator: 4, denominator: 1 },
    })

    // Then
    expect(result.success).toBe(true)
  })

  it("accepts an exact insertion beat when applying a note fragment", () => {
    // Given
    const project = fullProject()

    // When
    const result = ApplyComponentInput.safeParse({
      project_id: project.id,
      base_revision: project.revision,
      component_id: "00000000-0000-4000-8000-000000000004",
      at: { numerator: 5, denominator: 3 },
    })

    // Then
    expect(result.success).toBe(true)
  })
})
