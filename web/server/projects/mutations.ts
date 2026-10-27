import { randomUUID } from "node:crypto"

import {
  type GenerationProject,
  GenerationProjectSchema,
  ProjectWorkspaceSchema,
} from "../../shared/generation-projects.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ProjectMutationSchema } from "../../shared/project-commands.ts"
import {
  GenerationProjectIdSchema,
  ProjectRevisionSchema,
  WorkspaceRevisionSchema,
} from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { PersistedStateV3 } from "../library/state.ts"
import type { StudioStore } from "../store.ts"
import { componentSummary, projectSummary } from "./views.ts"

export function createProject(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "create_project" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      if (!state.library.songs.some((song) => song.id === command.song_id))
        throw new StudioError(404, "song_not_found", "Song was not found")
      const project = GenerationProjectSchema.parse({
        schema_version: 1,
        id: GenerationProjectIdSchema.parse(randomUUID()),
        revision: 0,
        name: command.name,
        song_id: command.song_id,
        mode: command.mode,
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
      const project = GenerationProjectSchema.parse({
        ...current,
        revision: ProjectRevisionSchema.parse(current.revision + 1),
        name: command.name,
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
  state: PersistedStateV3,
  changes: Partial<PersistedStateV3["projects"]>,
): PersistedStateV3 {
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
  state: PersistedStateV3,
  extra: Omit<ProjectMutation, "workspace"> = {},
): ProjectMutation {
  return ProjectMutationSchema.parse({
    workspace: ProjectWorkspaceSchema.parse({
      revision: state.projects.revision,
      selected_project_id: state.projects.selected_project_id,
      projects: state.projects.records.map(projectSummary),
      components: state.projects.components.map(componentSummary),
    }),
    ...extra,
  })
}

export function requireProject(
  state: PersistedStateV3,
  id: GenerationProject["id"],
): GenerationProject {
  const project = state.projects.records.find((candidate) => candidate.id === id)
  if (project === undefined)
    throw new StudioError(404, "project_not_found", "Generation project was not found")
  return project
}

export function expectProjectRevision(project: GenerationProject, revision: number): void {
  if (project.revision !== revision)
    throw new StudioError(
      409,
      "project_revision_conflict",
      "Generation project revision is stale",
      project.revision,
    )
}
