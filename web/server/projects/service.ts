import type {
  GenerationProject,
  ProjectWorkspace,
  ReusableComponent,
} from "../../shared/generation-projects.ts"
import type { ChartId, LibraryChartDocument, LibrarySong } from "../../shared/library.ts"
import type {
  NativeRuleGeneration,
  ProjectCommand,
  ProjectMutation,
} from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord, StudioStore } from "../store.ts"
import { executeProjectCommand } from "./dispatcher.ts"

export interface ProjectNativeService {
  generate(
    project: GenerationProject,
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ): Promise<NativeRuleGeneration>
}

export class ProjectService {
  constructor(
    readonly store: StudioStore,
    readonly nativeRules: ProjectNativeService,
  ) {}

  list(): ProjectWorkspace {
    return this.store.projects()
  }

  songs(): readonly LibrarySong[] {
    return this.store.library().songs
  }

  chart(id: ChartId): LibraryChartDocument {
    return this.store.chartDocument(id)
  }

  read(id: GenerationProjectId): GenerationProject {
    const project = this.#record(id)
    if (project === undefined)
      throw new StudioError(404, "project_not_found", "Generation project was not found")
    return structuredClone(project)
  }

  component(id: ComponentId): ReusableComponent {
    const component = this.#component(id)
    if (component === undefined)
      throw new StudioError(404, "component_not_found", "Reusable component was not found")
    return structuredClone(component)
  }

  command(command: ProjectCommand, signal?: AbortSignal): Promise<ProjectMutation> {
    signal?.throwIfAborted()
    return executeProjectCommand(this.store, this.nativeRules, command, signal)
  }

  #record(id: GenerationProjectId): GenerationProject | undefined {
    return this.store.generationProject(id)
  }

  #component(id: ComponentId): ReusableComponent | undefined {
    return this.store.reusableComponent(id)
  }
}
