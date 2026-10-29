import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  BaseUcsSourceOptionsSchema,
  BeatChartDocumentSchema,
  BeatProjectWorkspaceSchema,
  GenerationProjectV2Schema,
} from "../shared/beat-projects.ts"
import { ProjectMutationSchema } from "../shared/project-commands.ts"

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock("../src/api/http.ts", () => ({ http: httpMock }))

import { projectsApi } from "../src/api/projects-client.ts"

const projectId = "00000000-0000-4000-8000-000000000001"
const songId = "00000000-0000-4000-8000-000000000002"

function projectFixture() {
  return GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: projectId,
    revision: 2,
    name: "Single rules",
    song_id: songId,
    mode: "Single",
    chart_artist: "Stepper",
    base_ucs_ref: { source: "saved_chart", chart_id: "00000000-0000-4000-8000-000000000003" },
    timing: timingFixture(),
    evaluation_contract: evaluationFixture(),
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
    const project = projectFixture()
    const workspace = BeatProjectWorkspaceSchema.parse({
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
    const project = projectFixture()
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

  it("loads the authoritative immutable song timing template", async () => {
    // Given
    const project = projectFixture()
    const template = BeatChartDocumentSchema.parse({
      schema_version: 1,
      title: "Template",
      artist: "Artist",
      chart_artist: "Stepper",
      mode: project.mode,
      timing: project.timing,
      notes: [],
      audio_sha256: "0".repeat(64),
      evaluation_contract: project.evaluation_contract,
      audio_asset: { format: "wav", byte_length: 0 },
    })
    httpMock.get.mockResolvedValue(new Response(JSON.stringify(template)))

    // When
    const loaded = await projectsApi.songTemplate(project.song_id)

    // Then
    expect(loaded).toEqual(template)
    expect(httpMock.get).toHaveBeenCalledWith(`/api/v1/projects/song-template/${project.song_id}`)
  })

  it("discovers retained timing bases through the canonical project API", async () => {
    // Given
    const project = projectFixture()
    const sources = BaseUcsSourceOptionsSchema.parse([
      {
        ref: { source: "retained_timing", song_id: project.song_id },
        label: "Original archive timing",
        mode: project.mode,
        timing: project.timing,
      },
    ])
    httpMock.get.mockResolvedValue(new Response(JSON.stringify(sources)))

    // When
    const loaded = await projectsApi.baseSources(project.song_id)

    // Then
    expect(loaded).toEqual(sources)
    expect(httpMock.get).toHaveBeenCalledWith(`/api/v1/projects/base-sources/${project.song_id}`)
  })
})

function timingFixture() {
  return {
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
  } as const
}

function evaluationFixture() {
  return {
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
  } as const
}
