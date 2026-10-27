import type { GenerationProject } from "../../shared/generation-projects.ts"
import type { SongId } from "../../shared/library.ts"
import type { ProjectCommand } from "../../shared/project-commands.ts"
import type { ComponentKind, GenerationProjectId } from "../../shared/project-identities.ts"
import type { ProjectFormValue } from "./project-form.ts"

export type PendingRuleNavigation =
  | { readonly kind: "close" }
  | { readonly kind: "new" }
  | { readonly kind: "inspect"; readonly projectId: GenerationProjectId }

export function createProjectCommand(
  value: ProjectFormValue & { readonly songId: SongId },
): ProjectCommand {
  return {
    type: "create_project",
    song_id: value.songId,
    mode: value.mode,
    name: value.name,
    timing: value.timing,
    evaluation_contract: value.evaluationContract,
    generation_rules: value.generationRules,
  }
}

export function writeProjectCommand(
  project: GenerationProject,
  value: ProjectFormValue,
): ProjectCommand {
  return {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: value.name,
    timing: value.timing,
    evaluation_contract: value.evaluationContract,
    generation_rules: value.generationRules,
  }
}

export function publishProjectComponentCommand(
  project: GenerationProject,
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
  current: GenerationProject | null,
  command: ProjectCommand,
  returned: GenerationProject | undefined,
): GenerationProject | null {
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
  returned: GenerationProject | undefined,
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
  returned: GenerationProject | undefined,
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
