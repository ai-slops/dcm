import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { GenerationProjectSchema, ProjectWorkspaceSchema } from "../shared/generation-projects.ts"
import { ProjectComponentLibrary } from "../src/ui/ProjectComponentLibrary.tsx"
import { ProjectOperations } from "../src/ui/ProjectOperations.tsx"
import { ProjectRuleDirtyGuard } from "../src/ui/ProjectRuleDirtyGuard.tsx"
import { ProjectRuleNavigationSurface } from "../src/ui/ProjectRuleNavigationSurface.tsx"
import { repoRoot } from "./support/paths.ts"

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

it("disables generation, publishing, and applying while visible rules are unsaved", async () => {
  // Given
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audio, ...timing } = demo.document.project.music
  const project = GenerationProjectSchema.parse({
    schema_version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    name: "Authored rules",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Double",
    timing,
    evaluation_contract: demo.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: timing.duration_ticks,
      step_ticks: timing.ticks_per_beat,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
    applied_components: {},
  })
  const {
    timing: _projectTiming,
    evaluation_contract: _projectEvaluation,
    generation_rules: _projectRules,
    ...projectSummary
  } = project
  const workspace = ProjectWorkspaceSchema.parse({
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
