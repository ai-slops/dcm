import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { GenerationProjectSchema } from "../shared/generation-projects.ts"
import { initialProjectJson, parseProjectForm } from "../src/ui/project-form.ts"
import {
  createProjectCommand,
  creatingAfterMutation,
  projectAfterMutation,
  projectLoadIsCurrent,
  ruleDirtyAfterMutation,
  writeProjectCommand,
} from "../src/ui/project-manager-commands.ts"
import { repoRoot } from "./support/paths.ts"

const projectId = "00000000-0000-4000-8000-000000000001"
const songId = "00000000-0000-4000-8000-000000000002"

async function projectFixture() {
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audio, ...timing } = demo.document.project.music
  return GenerationProjectSchema.parse({
    schema_version: 1,
    id: projectId,
    revision: 7,
    name: "Single rules",
    song_id: songId,
    mode: "Single",
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
}

it("keeps explicit mode on create and CAS revision on write", async () => {
  // Given
  const project = await projectFixture()
  const json = initialProjectJson(project)
  const form = parseProjectForm({
    name: project.name,
    mode: project.mode,
    timing: json.timing,
    evaluation: json.evaluation,
    rules: json.rules,
  })

  // When
  const create = createProjectCommand({ ...form, songId: project.song_id })
  const write = writeProjectCommand(project, form)

  // Then
  if (create.type !== "create_project") throw new TypeError("Expected create project command")
  if (write.type !== "write_project") throw new TypeError("Expected write project command")
  expect(create.mode).toBe("Single")
  expect(write.base_revision).toBe(7)
})

it("clears an inspected project after that exact project is deleted", async () => {
  // Given
  const project = await projectFixture()

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
  const project = await projectFixture()
  const command = createProjectCommand({
    ...parseProjectForm({
      name: project.name,
      mode: project.mode,
      ...initialProjectJson(project),
    }),
    songId: project.song_id,
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

it("defaults a new project to empty visual hybrid rules", async () => {
  // Given
  const demo = await loadDemo(repoRoot)

  // When
  const json = initialProjectJson(demo.document.project)

  // Then
  expect(JSON.parse(json.rules)).toEqual({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [],
    regions: [],
  })
})
