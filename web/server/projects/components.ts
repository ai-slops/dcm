import { randomUUID } from "node:crypto"
import { addBeats, compareBeats, subtractBeats } from "../../shared/beat.ts"
import {
  type BeatReusableComponent,
  BeatReusableComponentSchema,
  type GenerationProjectV2,
  GenerationProjectV2Schema,
  NoteFragmentV1Schema,
} from "../../shared/beat-projects.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ComponentIdSchema, ProjectRevisionSchema } from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { PersistedStateV4 } from "../library/state-v4.ts"
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
      const fragmentStart = command.start
      const fragmentEnd = command.end
      if (
        command.kind === "note_fragment" &&
        (fragmentStart === undefined || fragmentEnd === undefined)
      )
        throw new StudioError(
          400,
          "fragment_range_required",
          "Note fragments require start and end beats",
        )
      let componentInput: unknown
      switch (command.kind) {
        case "timing":
          componentInput = { ...common, kind: "timing", value: project.timing }
          break
        case "evaluation":
          componentInput = { ...common, kind: "evaluation", value: project.evaluation_contract }
          break
        case "generator":
          componentInput = { ...common, kind: "generator", value: project.generation_rules }
          break
        case "note_fragment":
          if (fragmentStart === undefined || fragmentEnd === undefined)
            throw new StudioError(
              400,
              "fragment_range_required",
              "Note fragments require start and end beats",
            )
          componentInput = {
            ...common,
            kind: "note_fragment",
            value: createFragment(project, fragmentStart, fragmentEnd),
          }
          break
        default:
          componentInput = assertNever(command.kind)
      }
      const component = BeatReusableComponentSchema.parse(componentInput)
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
      const project = apply(current, component, ref, command.at)
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
  current: GenerationProjectV2,
  component: BeatReusableComponent,
  ref: NonNullable<GenerationProjectV2["applied_components"]["timing"]>,
  at?: GenerationProjectV2["timing"]["duration"],
): GenerationProjectV2 {
  const common = { ...current, revision: ProjectRevisionSchema.parse(current.revision + 1) }
  switch (component.kind) {
    case "timing":
      return GenerationProjectV2Schema.parse({
        ...common,
        timing: component.value,
        applied_components: { ...current.applied_components, timing: ref },
      })
    case "evaluation":
      return GenerationProjectV2Schema.parse({
        ...common,
        evaluation_contract: component.value,
        applied_components: { ...current.applied_components, evaluation: ref },
      })
    case "generator":
      return GenerationProjectV2Schema.parse({
        ...common,
        generation_rules: component.value,
        applied_components: { ...current.applied_components, generator: ref },
      })
    case "note_fragment": {
      if (at === undefined || at === null)
        throw new StudioError(
          400,
          "fragment_anchor_required",
          "Applying a note fragment requires an anchor beat",
        )
      if (component.value.mode !== current.mode)
        throw new StudioError(
          409,
          "fragment_mode_mismatch",
          "Note fragment mode differs from destination project",
        )
      if (current.generation_rules.schema_version !== 2)
        throw new StudioError(
          409,
          "fragment_requires_hybrid",
          "Note fragments require hybrid generation rules",
        )
      const shifted = component.value.notes.map((note) => ({
        ...note,
        at: addBeats(at, note.at),
      }))
      const fixedNotes = [...current.generation_rules.fixed_notes, ...shifted].sort(
        (left, right) =>
          compareBeats(left.at, right.at) ||
          compareBeats(left.hold, right.hold) ||
          left.panel_mask - right.panel_mask,
      )
      return GenerationProjectV2Schema.parse({
        ...common,
        generation_rules: { ...current.generation_rules, fixed_notes: fixedNotes },
        applied_components: {
          ...current.applied_components,
          note_fragments: [...(current.applied_components.note_fragments ?? []), ref],
        },
      })
    }
    case "legacy_unresolved":
      throw new StudioError(
        409,
        "legacy_component_basis_missing",
        "Historical component beat basis is unknown",
      )
    default:
      return assertNever(component)
  }
}

function requireComponent(
  state: PersistedStateV4,
  id: BeatReusableComponent["id"],
): BeatReusableComponent {
  const component = state.projects.components.find((candidate) => candidate.id === id)
  if (component === undefined)
    throw new StudioError(404, "component_not_found", "Reusable component was not found")
  return component
}

function createFragment(
  project: GenerationProjectV2,
  start: NonNullable<Extract<ProjectCommand, { readonly type: "publish_component" }>["start"]>,
  end: NonNullable<Extract<ProjectCommand, { readonly type: "publish_component" }>["end"]>,
) {
  if (compareBeats(start, end) >= 0)
    throw new StudioError(400, "fragment_range_empty", "Note fragment range must be nonempty")
  if (project.generation_rules.schema_version !== 2)
    throw new StudioError(
      409,
      "fragment_requires_hybrid",
      "Note fragments require hybrid generation rules",
    )
  const notes = project.generation_rules.fixed_notes
    .filter(
      (note) =>
        compareBeats(note.at, start) >= 0 &&
        compareBeats(note.at, end) < 0 &&
        compareBeats(addBeats(note.at, note.hold), end) <= 0,
    )
    .map((note) => ({ ...note, at: subtractBeats(note.at, start) }))
  if (notes.length === 0)
    throw new StudioError(409, "fragment_empty", "Selected fragment range contains no fixed notes")
  return NoteFragmentV1Schema.parse({
    schema_version: 1,
    kind: "note_fragment_v1",
    mode: project.mode,
    span: subtractBeats(end, start),
    notes,
  })
}

function assertNever(value: never): never {
  throw new StudioError(400, "component_kind", `Unsupported component kind: ${String(value)}`)
}
