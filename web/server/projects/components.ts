import { randomUUID } from "node:crypto"

import {
  type GenerationProject,
  GenerationProjectSchema,
  type ReusableComponent,
  ReusableComponentSchema,
} from "../../shared/generation-projects.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ComponentIdSchema, ProjectRevisionSchema } from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { PersistedStateV3 } from "../library/state.ts"
import type { StudioStore } from "../store.ts"
import { bumpProjects, expectProjectRevision, projectResult, requireProject } from "./mutations.ts"

export function publishComponent(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "publish_component" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const project = requireProject(state, command.project_id)
      expectProjectRevision(project, command.base_revision)
      const common = {
        id: ComponentIdSchema.parse(randomUUID()),
        revision: 0,
        name: command.name,
        source_project_id: project.id,
        source_project_revision: project.revision,
      }
      const component = ReusableComponentSchema.parse(
        command.kind === "timing"
          ? { ...common, kind: "timing", value: project.timing }
          : command.kind === "evaluation"
            ? { ...common, kind: "evaluation", value: project.evaluation_contract }
            : { ...common, kind: "generator", value: project.generation_rules },
      )
      const next = bumpProjects(state, { components: [...state.projects.components, component] })
      return { state: next, result: projectResult(next, { component }) }
    },
    signal,
  )
}

export function applyComponent(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "apply_component" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const current = requireProject(state, command.project_id)
      expectProjectRevision(current, command.base_revision)
      const component = requireComponent(state, command.component_id)
      const ref = {
        component_id: component.id,
        component_revision: component.revision,
        source_project_id: component.source_project_id,
        source_project_revision: component.source_project_revision,
      }
      const project = apply(current, component, ref)
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

export function deleteComponent(
  store: StudioStore,
  command: Extract<ProjectCommand, { readonly type: "delete_component" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const component = requireComponent(state, command.component_id)
      if (component.revision !== command.base_revision)
        throw new StudioError(
          409,
          "component_revision_conflict",
          "Component revision is stale",
          component.revision,
        )
      const next = bumpProjects(state, {
        components: state.projects.components.filter((candidate) => candidate.id !== component.id),
      })
      return { state: next, result: projectResult(next) }
    },
    signal,
  )
}

function apply(
  current: GenerationProject,
  component: ReusableComponent,
  ref: GenerationProject["applied_components"]["timing"],
): GenerationProject {
  const common = { ...current, revision: ProjectRevisionSchema.parse(current.revision + 1) }
  switch (component.kind) {
    case "timing":
      return GenerationProjectSchema.parse({
        ...common,
        timing: component.value,
        applied_components: { ...current.applied_components, timing: ref },
      })
    case "evaluation":
      return GenerationProjectSchema.parse({
        ...common,
        evaluation_contract: component.value,
        applied_components: { ...current.applied_components, evaluation: ref },
      })
    case "generator":
      return GenerationProjectSchema.parse({
        ...common,
        generation_rules: component.value,
        applied_components: { ...current.applied_components, generator: ref },
      })
    default:
      return assertNever(component)
  }
}

function requireComponent(state: PersistedStateV3, id: ReusableComponent["id"]): ReusableComponent {
  const component = state.projects.components.find((candidate) => candidate.id === id)
  if (component === undefined)
    throw new StudioError(404, "component_not_found", "Reusable component was not found")
  return component
}

function assertNever(value: never): never {
  throw new StudioError(400, "component_kind", `Unsupported component kind: ${String(value)}`)
}
