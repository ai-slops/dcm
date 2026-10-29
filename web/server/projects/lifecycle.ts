import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import type { StudioStore } from "../store.ts"
import { bumpProjects, expectProjectRevision, projectResult, requireProject } from "./mutations.ts"

export function selectProject(
  store: StudioStore,
  id: GenerationProjectV2["id"] | null,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      if (id !== null) requireProject(state, id)
      const next = bumpProjects(state, { selected_project_id: id })
      return { state: next, result: projectResult(next) }
    },
    signal,
  )
}

export function deleteProject(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "delete_project" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const current = requireProject(state, command.project_id)
      expectProjectRevision(current, command.base_revision)
      const next = bumpProjects(state, {
        records: state.projects.records.filter((project) => project.id !== current.id),
        selected_project_id:
          state.projects.selected_project_id === current.id
            ? null
            : state.projects.selected_project_id,
      })
      return { state: next, result: projectResult(next) }
    },
    signal,
  )
}
