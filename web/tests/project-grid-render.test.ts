import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { GenerationProjectV2Schema } from "../shared/beat-projects.ts"
import { LibrarySongSchema } from "../shared/library.ts"
import { beatPlaybackProjectFor } from "../src/domain/project-grid.ts"
import { ProjectGridEditor } from "../src/ui/ProjectGridEditor.tsx"

function fixture() {
  const project = GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    name: "Visual rules",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Double",
    chart_artist: "Stepper",
    base_ucs_ref: {
      source: "saved_chart",
      chart_id: "00000000-0000-4000-8000-000000000004",
    },
    applied_components: {},
    timing: {
      schema_version: 1,
      offset_micros: 0,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        },
      ],
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 }],
      duration: { numerator: 8, denominator: 1 },
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
      fixed_notes: [
        {
          at: { numerator: 0, denominator: 1 },
          panel_mask: 1,
          hold: { numerator: 0, denominator: 1 },
        },
      ],
      regions: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Verse",
          rules: {
            start: { numerator: 2, denominator: 1 },
            end: { numerator: 6, denominator: 1 },
            step: { numerator: 1, denominator: 1 },
            pattern: [
              {
                choices: [
                  {
                    panel_mask: 2,
                    hold: { numerator: 0, denominator: 1 },
                    weight: 1,
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  })
  const song = LibrarySongSchema.parse({
    id: project.song_id,
    title: "Stored song",
    artist: "Stored artist",
    audio: { format: "wav", byte_length: 44, sha256: "0".repeat(64) },
  })
  return { project, song }
}

it.each([true, false])("resolves rule-project playback extent with fixed notes %s", (hasNotes) => {
  const { project, song } = fixture()
  const rules = project.generation_rules
  if (rules.schema_version !== 2) throw new Error("Expected hybrid fixture")
  const source = GenerationProjectV2Schema.parse({
    ...project,
    timing: { ...project.timing, duration: null },
    generation_rules: { ...rules, fixed_notes: hasNotes ? rules.fixed_notes : [] },
  })

  const playback = beatPlaybackProjectFor(source, song)

  expect(playback.timing.duration).toEqual({ numerator: 6, denominator: 1 })
  expect(source.timing.duration).toBeNull()
  expect(source.generation_rules).toEqual({
    ...rules,
    fixed_notes: hasNotes ? rules.fixed_notes : [],
  })
})

it("renders fixed-note authoring and named automatic region controls", async () => {
  // Given
  const { project, song } = await fixture()

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: false,
      components: [],
      dirty: true,
      generation: null,
      project,
      song,
      onApplyFragment: () => undefined,
      onGenerate: () => undefined,
      onOpenGenerated: () => undefined,
      onProject: () => undefined,
      onPublishFragment: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Unsaved project draft")
  expect(markup).toContain("Verse · automatic")
  expect(markup).toContain("Scroll sideways inside the timeline to reach all 10 lanes")
  expect(markup).toContain("Clear verse")
  expect(markup).toContain("Visual rules")
  expect(markup).not.toContain("Stored artist")
  expect(markup).not.toContain("Chart artist")
  expect(markup).toContain("Publish note fragment")
  expect(markup).toContain("Save project rules before generating")
  expect(markup).not.toContain("Hold duration ticks")
})

it("requires explicit confirmation before converting V1 rules", async () => {
  // Given
  const { project, song } = await fixture()
  const legacy = GenerationProjectV2Schema.parse({
    ...project,
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start: { numerator: 0, denominator: 1 },
      end: { numerator: 8, denominator: 1 },
      step: { numerator: 1, denominator: 1 },
      pattern: [
        {
          choices: [
            {
              panel_mask: 1,
              hold: { numerator: 0, denominator: 1 },
              weight: 1,
            },
          ],
        },
      ],
    },
  })

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: false,
      components: [],
      dirty: false,
      generation: null,
      project: legacy,
      song,
      onApplyFragment: () => undefined,
      onGenerate: () => undefined,
      onOpenGenerated: () => undefined,
      onProject: () => undefined,
      onPublishFragment: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Visual grid conversion required")
  expect(markup).toContain("Convert to visual hybrid rules")
  expect(markup).toContain("can resample generated output")
  expect(markup).not.toContain("Confirm conversion")
})

it("locks region timing and generation fields during a mutation", async () => {
  // Given
  const { project, song } = await fixture()

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: true,
      components: [],
      dirty: true,
      generation: null,
      project,
      song,
      onApplyFragment: () => undefined,
      onGenerate: () => undefined,
      onOpenGenerated: () => undefined,
      onProject: () => undefined,
      onPublishFragment: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toMatch(/<input disabled="" required="" id="[^"]+" value="Verse"\/>/)
  expect(markup).toContain('disabled="" required="" value="Generated chart"')
  expect(markup).toMatch(/<input class="mono" disabled="" required="" id="[^"]+"[^>]*value=""\/>/)
})
