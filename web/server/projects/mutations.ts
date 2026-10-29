import { randomUUID } from "node:crypto"

import {
  BeatProjectWorkspaceSchema,
  type GenerationProjectV2,
  GenerationProjectV2Schema,
} from "../../shared/beat-projects.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ProjectMutationSchema } from "../../shared/project-commands.ts"
import {
  GenerationProjectIdSchema,
  ProjectRevisionSchema,
  WorkspaceRevisionSchema,
} from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { PersistedStateV4 } from "../library/state-v4.ts"
import type { StudioStore } from "../store.ts"
import { projectSummary } from "./views.ts"

export function createProject(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "create_project" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const song = state.library.songs.find((candidate) => candidate.id === command.song_id)
      if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
      const base = command.base_ucs_ref
      switch (base.source) {
        case "saved_chart": {
          const chart = state.library.charts.find(
            (candidate) => candidate.id === base.chart_id && candidate.song_id === command.song_id,
          )
          if (chart === undefined)
            throw new StudioError(
              409,
              "base_ucs_ref_invalid",
              "Saved base chart is not available for this song",
            )
          if (!sameTimingBasis(chart.project.timing, command.timing))
            throw new StudioError(
              409,
              "base_timing_mismatch",
              "Project timing differs from selected base chart",
            )
          break
        }
        case "archive_entry": {
          const archive = state.library.archives.find(
            (candidate) =>
              candidate.id === base.archive_id && candidate.sha256 === base.archive_sha256,
          )
          if (
            archive === undefined ||
            song.archive_id !== archive.id ||
            song.archive_source?.chart_name !== base.entry_name
          )
            throw new StudioError(
              409,
              "base_ucs_ref_invalid",
              "Archive base entry is not available for this song",
            )
          if (!sameTimingBasis(song.archive_source.timing, command.timing))
            throw new StudioError(
              409,
              "base_timing_mismatch",
              "Project timing differs from selected archive entry",
            )
          break
        }
        case "retained_timing": {
          if (base.song_id !== command.song_id || song.archive_source === undefined)
            throw new StudioError(
              409,
              "base_ucs_ref_invalid",
              "Retained timing is not available for this song",
            )
          if (!sameTimingBasis(song.archive_source.timing, command.timing))
            throw new StudioError(
              409,
              "base_timing_mismatch",
              "Project timing differs from retained song timing",
            )
          break
        }
      }
      const project = GenerationProjectV2Schema.parse({
        schema_version: 2,
        id: GenerationProjectIdSchema.parse(randomUUID()),
        revision: 0,
        name: command.name,
        song_id: command.song_id,
        mode: command.mode,
        chart_artist: command.chart_artist,
        base_ucs_ref: command.base_ucs_ref,
        timing: command.timing,
        evaluation_contract: command.evaluation_contract,
        generation_rules: command.generation_rules,
        applied_components: {},
      })
      const next = bumpProjects(state, {
        records: [...state.projects.records, project],
        selected_project_id: project.id,
      })
      return { state: next, result: projectResult(next, { project }) }
    },
    signal,
  )
}

export function writeProject(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "write_project" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const current = requireProject(state, command.project_id)
      expectProjectRevision(current, command.base_revision)
      const project = GenerationProjectV2Schema.parse({
        ...current,
        revision: ProjectRevisionSchema.parse(current.revision + 1),
        name: command.name,
        chart_artist: command.chart_artist,
        timing: command.timing,
        evaluation_contract: command.evaluation_contract,
        generation_rules: command.generation_rules,
      })
      const next = bumpProjects(state, {
        records: state.projects.records.map((candidate) =>
          candidate.id === project.id ? project : candidate,
        ),
      })
      return { state: next, result: projectResult(next, { project }) }
    },
    signal,
  )
}

export function bumpProjects(
  state: PersistedStateV4,
  changes: Partial<PersistedStateV4["projects"]>,
): PersistedStateV4 {
  return {
    ...state,
    projects: {
      ...state.projects,
      ...changes,
      revision: WorkspaceRevisionSchema.parse(state.projects.revision + 1),
    },
  }
}

export function projectResult(
  state: PersistedStateV4,
  extra: Omit<ProjectMutation, "workspace"> = {},
): ProjectMutation {
  return ProjectMutationSchema.parse({
    workspace: BeatProjectWorkspaceSchema.parse({
      revision: state.projects.revision,
      selected_project_id: state.projects.selected_project_id,
      projects: state.projects.records.map(projectSummary),
      components: state.projects.components,
    }),
    ...extra,
  })
}

export function requireProject(
  state: PersistedStateV4,
  id: GenerationProjectV2["id"],
): GenerationProjectV2 {
  const project = state.projects.records.find((candidate) => candidate.id === id)
  if (project === undefined)
    throw new StudioError(404, "project_not_found", "Generation project was not found")
  return project
}

export function expectProjectRevision(project: GenerationProjectV2, revision: number): void {
  if (project.revision !== revision)
    throw new StudioError(
      409,
      "project_revision_conflict",
      "Generation project revision is stale",
      project.revision,
    )
}

function sameTimingBasis(
  left: Extract<ProjectCommand, { readonly type: "create_project" }>["timing"],
  right: Extract<ProjectCommand, { readonly type: "create_project" }>["timing"],
): boolean {
  const { duration: _leftDuration, ...leftBasis } = left
  const { duration: _rightDuration, ...rightBasis } = right
  return JSON.stringify(leftBasis) === JSON.stringify(rightBasis)
}
