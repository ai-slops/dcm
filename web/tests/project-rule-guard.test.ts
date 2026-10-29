import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { BeatProjectWorkspaceSchema, GenerationProjectV2Schema } from "../shared/beat-projects.ts"
import { ProjectComponentLibrary } from "../src/ui/ProjectComponentLibrary.tsx"
import { ProjectOperations } from "../src/ui/ProjectOperations.tsx"
import { ProjectRuleDirtyGuard } from "../src/ui/ProjectRuleDirtyGuard.tsx"
import { ProjectRuleNavigationSurface } from "../src/ui/ProjectRuleNavigationSurface.tsx"

it("requires explicit discard or cancel before leaving authored rule edits", () => {
  // Given / When
  const markup = renderToStaticMarkup(
    createElement(ProjectRuleDirtyGuard, {
      onDiscard: () => undefined,
      onCancel: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Unsaved project rule changes")
  expect(markup).toContain("Discard changes")
  expect(markup).toMatch(/<button[^>]*data-initial-focus="true"[^>]*>.*Cancel/s)
})

it("keeps the exact unsaved rule draft mounted while navigation confirmation is open", () => {
  // Given / When
  const markup = renderToStaticMarkup(
    createElement(
      ProjectRuleNavigationSurface,
      {
        pending: true,
        onDiscard: () => undefined,
        onCancel: () => undefined,
      },
      createElement("textarea", { defaultValue: '{"step_ticks":2}' }),
    ),
  )

  // Then
  expect(markup).toContain("Unsaved project rule changes")
  expect(markup).toMatch(/<div hidden=""><textarea>.*step_ticks.*2.*<\/textarea><\/div>/)
})

it("disables generation, publishing, and applying while visible rules are unsaved", () => {
  // Given
  const project = GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    name: "Authored rules",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Double",
    chart_artist: "Stepper",
    base_ucs_ref: null,
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
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start: { numerator: 0, denominator: 1 },
      end: { numerator: 4, denominator: 1 },
      step: { numerator: 1, denominator: 1 },
      pattern: [
        { choices: [{ panel_mask: 1, hold: { numerator: 0, denominator: 1 }, weight: 1 }] },
      ],
    },
    applied_components: {},
  })
  const {
    timing: _projectTiming,
    evaluation_contract: _projectEvaluation,
    generation_rules: _projectRules,
    ...projectSummary
  } = project
  const workspace = BeatProjectWorkspaceSchema.parse({
    revision: 0,
    selected_project_id: project.id,
    projects: [projectSummary],
    components: [],
  })

  // When
  const generation = renderToStaticMarkup(
    createElement(ProjectOperations, {
      busy: false,
      rulesDirty: true,
      project,
      generation: null,
      onCommand: () => undefined,
      onOpen: () => undefined,
    }),
  )
  const library = renderToStaticMarkup(
    createElement(ProjectComponentLibrary, {
      busy: false,
      rulesDirty: true,
      workspace,
      selectedProjectId: project.id,
      onPublish: () => undefined,
      onApply: () => undefined,
      onDelete: () => undefined,
    }),
  )

  // Then
  expect(generation).toContain("Save project rules before generating")
  expect(generation).toMatch(/<button[^>]*disabled=""[^>]*>.*Generate/s)
  expect(library).toContain("Save project rules before publishing or applying")
  expect(library).toMatch(/<button[^>]*disabled=""[^>]*>.*Publish/s)
})
