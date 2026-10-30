import { expect, it } from "vitest"

import { GenerationProjectV2Schema } from "../shared/beat-projects.ts"
import { initialBeatProjectJson, parseBeatProjectForm } from "../src/ui/project-form.ts"
import {
  createProjectCommand,
  creatingAfterMutation,
  projectAfterMutation,
  projectLoadIsCurrent,
  ruleDirtyAfterMutation,
  writeProjectCommand,
} from "../src/ui/project-manager-commands.ts"

const projectId = "00000000-0000-4000-8000-000000000001"
const songId = "00000000-0000-4000-8000-000000000002"

function projectFixture() {
  return GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: projectId,
    revision: 7,
    name: "Single rules",
    song_id: songId,
    mode: "Single",
    chart_artist: "Stepper",
    base_ucs_ref: { source: "saved_chart", chart_id: "00000000-0000-4000-8000-000000000003" },
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
}

it("keeps explicit mode on create and CAS revision on write", async () => {
  // Given
  const project = projectFixture()
  const json = initialBeatProjectJson(project)
  const form = parseBeatProjectForm({
    name: project.name,
    mode: project.mode,
    timing: json.timing,
    evaluation: json.evaluation,
    rules: json.rules,
  })

  // When
  const create = createProjectCommand({
    ...form,
    songId: project.song_id,
    baseUcsRef: requiredBase(project),
  })
  const write = writeProjectCommand(project, form)

  // Then
  if (create.type !== "create_project") throw new TypeError("Expected create project command")
  if (write.type !== "write_project") throw new TypeError("Expected write project command")
  expect(create.mode).toBe("Single")
  expect(create.chart_artist).toBeNull()
  expect(write.base_revision).toBe(7)
  expect(write.chart_artist).toBe("Stepper")
})

it("clears an inspected project after that exact project is deleted", async () => {
  // Given
  const project = projectFixture()

  // When
  const next = projectAfterMutation(
    project,
    { type: "delete_project", project_id: project.id, base_revision: project.revision },
    undefined,
  )

  // Then
  expect(next).toBeNull()
})

it("enters edit mode and clears rule dirtiness after project creation succeeds", async () => {
  // Given
  const project = projectFixture()
  const command = createProjectCommand({
    ...parseBeatProjectForm({
      name: project.name,
      mode: project.mode,
      ...initialBeatProjectJson(project),
    }),
    songId: project.song_id,
    baseUcsRef: requiredBase(project),
  })

  // When / Then
  expect(creatingAfterMutation(true, command, project)).toBe(false)
  expect(ruleDirtyAfterMutation(true, command, project)).toBe(false)
})

it("rejects a project load response after a newer navigation generation starts", () => {
  // Given / When / Then
  expect(projectLoadIsCurrent(4, 4)).toBe(true)
  expect(projectLoadIsCurrent(4, 5)).toBe(false)
})

it("preserves empty visual hybrid rules", () => {
  // Given / When
  const json = initialBeatProjectJson({
    ...projectFixture(),
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [],
    },
  })

  // Then
  expect(JSON.parse(json.rules)).toEqual({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [],
    regions: [],
  })
})

function requiredBase(project: ReturnType<typeof projectFixture>) {
  if (project.base_ucs_ref === null) throw new TypeError("Fixture requires base timing")
  return project.base_ucs_ref
}
