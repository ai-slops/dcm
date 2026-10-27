import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { GenerationProjectSchema, ProjectWorkspaceSchema } from "../shared/generation-projects.ts"
import { ProjectMutationSchema } from "../shared/project-commands.ts"
import { repoRoot } from "./support/paths.ts"

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock("../src/api/http.ts", () => ({ http: httpMock }))

import { projectsApi } from "../src/api/projects-client.ts"

const projectId = "00000000-0000-4000-8000-000000000001"
const songId = "00000000-0000-4000-8000-000000000002"

async function projectFixture() {
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audio, ...timing } = demo.document.project.music
  return GenerationProjectSchema.parse({
    schema_version: 1,
    id: projectId,
    revision: 2,
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
      step_ticks: 48,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
    applied_components: {},
  })
}

function projectSummary(project: Awaited<ReturnType<typeof projectFixture>>) {
  const {
    timing: _timing,
    evaluation_contract: _evaluation,
    generation_rules: _rules,
    ...summary
  } = project
  return summary
}

describe("projectsApi", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads the canonical project workspace and full project routes", async () => {
    // Given
    const project = await projectFixture()
    const workspace = ProjectWorkspaceSchema.parse({
      revision: 3,
      selected_project_id: project.id,
      projects: [projectSummary(project)],
      components: [],
    })
    httpMock.get
      .mockResolvedValueOnce(new Response(JSON.stringify(workspace)))
      .mockResolvedValueOnce(new Response(JSON.stringify(project)))

    // When
    const listed = await projectsApi.list()
    const loaded = await projectsApi.project(project.id)

    // Then
    expect(listed).toEqual(workspace)
    expect(loaded).toEqual(project)
    expect(httpMock.get).toHaveBeenNthCalledWith(1, "/api/v1/projects")
    expect(httpMock.get).toHaveBeenNthCalledWith(2, `/api/v1/projects/${projectId}`)
  })

  it("posts project commands with the CSRF header", async () => {
    // Given
    const project = await projectFixture()
    const mutation = ProjectMutationSchema.parse({
      workspace: {
        revision: 4,
        selected_project_id: project.id,
        projects: [projectSummary(project)],
        components: [],
      },
      project,
    })
    httpMock.post.mockResolvedValue(new Response(JSON.stringify(mutation)))

    // When
    await projectsApi.command("csrf", {
      type: "select_project",
      project_id: project.id,
    })

    // Then
    expect(httpMock.post).toHaveBeenCalledWith("/api/v1/projects/actions", {
      headers: { "x-csrf-token": "csrf" },
      json: { type: "select_project", project_id: project.id },
    })
  })
})
