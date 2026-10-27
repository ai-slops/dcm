import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { StudioError } from "../errors.ts"
import type { StudioStore } from "../store.ts"
import { applyComponent, deleteComponent, publishComponent } from "./components.ts"
import { generateProject } from "./generation.ts"
import { deleteProject, selectProject } from "./lifecycle.ts"
import { createProject, writeProject } from "./mutations.ts"
import type { ProjectNativeService } from "./service.ts"

export function executeProjectCommand(
  store: StudioStore,
  nativeRules: ProjectNativeService,
  command: ProjectCommand,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  switch (command.type) {
    case "create_project":
      return createProject(store, command, signal)
    case "write_project":
      return writeProject(store, command, signal)
    case "select_project":
      return selectProject(store, command.project_id, signal)
    case "delete_project":
      return deleteProject(store, command, signal)
    case "publish_component":
      return publishComponent(store, command, signal)
    case "apply_component":
      return applyComponent(store, command, signal)
    case "delete_component":
      return deleteComponent(store, command, signal)
    case "generate_project":
      return generateProject(store, nativeRules, command, signal)
    default:
      return assertNever(command)
  }
}

function assertNever(value: never): never {
  throw new StudioError(400, "project_command", `Unsupported project command: ${String(value)}`)
}
