import type { BaseUcsRef } from "../../shared/beat.ts"
import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { SongId } from "../../shared/library.ts"
import type { ProjectCommand } from "../../shared/project-commands.ts"
import type { ComponentKind, GenerationProjectId } from "../../shared/project-identities.ts"
import type { BeatProjectFormValue } from "./project-form.ts"

export type PendingRuleNavigation =
  | { readonly kind: "close" }
  | { readonly kind: "new" }
  | { readonly kind: "inspect"; readonly projectId: GenerationProjectId }

export function createProjectCommand(
  value: BeatProjectFormValue & {
    readonly songId: SongId
    readonly baseUcsRef: BaseUcsRef
  },
): ProjectCommand {
  return {
    type: "create_project",
    song_id: value.songId,
    mode: value.mode,
    base_ucs_ref: value.baseUcsRef,
    name: value.name,
    chart_artist: null,
    timing: value.timing,
    evaluation_contract: value.evaluationContract,
    generation_rules: value.generationRules,
  }
}

export function writeProjectCommand(
  project: GenerationProjectV2,
  value: BeatProjectFormValue,
): ProjectCommand {
  return {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: value.name,
    chart_artist: project.chart_artist,
    timing: value.timing,
    evaluation_contract: value.evaluationContract,
    generation_rules: value.generationRules,
  }
}

export function publishProjectComponentCommand(
  project: GenerationProjectV2,
  kind: ComponentKind,
  name: string,
): ProjectCommand {
  return {
    type: "publish_component",
    project_id: project.id,
    base_revision: project.revision,
    kind,
    name,
  }
}

export function projectAfterMutation(
  current: GenerationProjectV2 | null,
  command: ProjectCommand,
  returned: GenerationProjectV2 | undefined,
): GenerationProjectV2 | null {
  switch (command.type) {
    case "create_project":
    case "write_project":
    case "publish_component":
    case "apply_component":
    case "generate_project":
      return returned ?? current
    case "select_project":
    case "delete_component":
      return current
    case "delete_project":
      return current?.id === command.project_id ? null : current
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}

export function creatingAfterMutation(
  current: boolean,
  command: ProjectCommand,
  returned: GenerationProjectV2 | undefined,
): boolean {
  switch (command.type) {
    case "create_project":
      return returned === undefined ? current : false
    case "write_project":
    case "select_project":
    case "delete_project":
    case "publish_component":
    case "apply_component":
    case "delete_component":
    case "generate_project":
      return current
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}

export function projectLoadIsCurrent(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration
}

export function ruleDirtyAfterMutation(
  current: boolean,
  command: ProjectCommand,
  returned: GenerationProjectV2 | undefined,
): boolean {
  switch (command.type) {
    case "create_project":
    case "write_project":
      return returned === undefined ? current : false
    case "select_project":
    case "delete_project":
    case "publish_component":
    case "apply_component":
    case "delete_component":
    case "generate_project":
      return current
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}
