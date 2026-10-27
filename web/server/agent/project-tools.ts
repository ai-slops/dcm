import type { AgentWriteAccess } from "../../shared/api.ts"
import type {
  GenerationProject,
  ProjectWorkspace,
  ReusableComponent,
} from "../../shared/generation-projects.ts"
import type { ChartId, LibraryChartDocument, LibrarySong } from "../../shared/library.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"

type CommandInput<Kind extends ProjectCommand["type"]> = Omit<
  Extract<ProjectCommand, { readonly type: Kind }>,
  "type"
>

type PersistedReceipt = {
  readonly status: "persisted"
  readonly workspace_revision: number
}

export type ProjectMutationReceipt = PersistedReceipt & {
  readonly entity: {
    readonly kind: "project" | "component"
    readonly id: string
    readonly revision: number
  }
}

export type ProjectGenerationReceipt = PersistedReceipt & {
  readonly entity: { readonly kind: "chart"; readonly id: string }
  readonly generation: {
    readonly accepted: boolean
    readonly rejection_count: number
    readonly mode: "Single" | "Double"
    readonly note_count: number
    readonly request_sha256: string
    readonly source_project_id: string
    readonly source_project_revision: number
    readonly seed: string
    readonly certification: {
      readonly status: "none"
      readonly reason: "not_generated_from_verified_bundle"
    }
  }
}

export type AgentProjectService = {
  readonly list: () => ProjectWorkspace
  readonly songs: () => readonly LibrarySong[]
  readonly chart: (chartId: ChartId) => LibraryChartDocument
  readonly read: (projectId: GenerationProjectId) => GenerationProject
  readonly component: (componentId: ComponentId) => ReusableComponent
  readonly command: (command: ProjectCommand, signal?: AbortSignal) => Promise<ProjectMutation>
}

type ProjectAgentToolsOptions = {
  readonly service: AgentProjectService
  readonly writeAccess: AgentWriteAccess
  readonly signal: AbortSignal
  readonly onMutation: () => void
}

export class ProjectAgentTools {
  readonly #options: ProjectAgentToolsOptions

  constructor(options: ProjectAgentToolsOptions) {
    this.#options = options
  }

  listProjects() {
    this.#assertActive()
    const workspace = this.#options.service.list()
    return {
      workspace_revision: workspace.revision,
      selected_project_id: workspace.selected_project_id,
      projects: workspace.projects,
    }
  }

  readProject(input: { readonly project_id: GenerationProjectId }): GenerationProject {
    this.#assertActive()
    return this.#options.service.read(input.project_id)
  }

  listSongs() {
    this.#assertActive()
    return {
      songs: this.#options.service.songs().map(({ id, title, artist }) => ({ id, title, artist })),
    }
  }

  readChart(input: { readonly chart_id: ChartId }): LibraryChartDocument {
    this.#assertActive()
    return this.#options.service.chart(input.chart_id)
  }

  listComponents() {
    this.#assertActive()
    const workspace = this.#options.service.list()
    return { workspace_revision: workspace.revision, components: workspace.components }
  }

  readComponent(input: { readonly component_id: ComponentId }): ReusableComponent {
    this.#assertActive()
    return this.#options.service.component(input.component_id)
  }

  createProject(input: CommandInput<"create_project">, signal?: AbortSignal) {
    return this.#command({ type: "create_project", ...input }, "project", signal)
  }

  writeProject(input: CommandInput<"write_project">, signal?: AbortSignal) {
    return this.#command({ type: "write_project", ...input }, "project", signal)
  }

  generateProject(input: CommandInput<"generate_project">, signal?: AbortSignal) {
    return this.#command({ type: "generate_project", ...input }, "chart", signal)
  }

  publishComponent(input: CommandInput<"publish_component">, signal?: AbortSignal) {
    return this.#command({ type: "publish_component", ...input }, "component", signal)
  }

  applyComponent(input: CommandInput<"apply_component">, signal?: AbortSignal) {
    return this.#command({ type: "apply_component", ...input }, "project", signal)
  }

  async #command(
    command: ProjectCommand,
    entityKind: ProjectMutationReceipt["entity"]["kind"] | "chart",
    signal?: AbortSignal,
  ): Promise<ProjectMutationReceipt | ProjectGenerationReceipt> {
    if (this.#options.writeAccess !== "projects_and_components")
      throw new StudioError(
        403,
        "agent_write_denied",
        "This run does not have project and component write access",
      )
    const operationSignal =
      signal === undefined ? this.#options.signal : AbortSignal.any([this.#options.signal, signal])
    this.#assertActive(operationSignal)
    const mutation = await this.#options.service.command(command, operationSignal)
    this.#options.onMutation()
    return receipt(mutation, entityKind)
  }

  #assertActive(signal: AbortSignal = this.#options.signal): void {
    if (signal.aborted) throw new StudioError(409, "run_cancelled", "Run is no longer active")
  }
}

function receipt(
  mutation: ProjectMutation,
  entityKind: ProjectMutationReceipt["entity"]["kind"] | "chart",
): ProjectMutationReceipt | ProjectGenerationReceipt {
  if (entityKind === "project" && mutation.project !== undefined)
    return {
      status: "persisted",
      workspace_revision: mutation.workspace.revision,
      entity: { kind: "project", id: mutation.project.id, revision: mutation.project.revision },
    }
  if (entityKind === "component" && mutation.component !== undefined)
    return {
      status: "persisted",
      workspace_revision: mutation.workspace.revision,
      entity: {
        kind: "component",
        id: mutation.component.id,
        revision: mutation.component.revision,
      },
    }
  if (entityKind === "chart" && mutation.generation !== undefined)
    return {
      status: "persisted",
      workspace_revision: mutation.workspace.revision,
      entity: {
        kind: "chart",
        id: mutation.generation.chart_id,
      },
      generation: {
        accepted: mutation.generation.assessment.accepted,
        rejection_count: mutation.generation.assessment.rejections.length,
        mode: mutation.generation.mode,
        note_count: mutation.generation.chart.notes.reduce(
          (total, note) => total + bitCount(note.panel_mask),
          0,
        ),
        request_sha256: mutation.generation.request_sha256,
        source_project_id: mutation.generation.project_id,
        source_project_revision: mutation.generation.project_revision,
        seed: mutation.generation.seed,
        certification: mutation.generation.certification,
      },
    }
  throw new StudioError(500, "project_mutation_result", "Project mutation result was incomplete")
}

function bitCount(value: number): number {
  let remaining = value
  let count = 0
  while (remaining !== 0) {
    count += remaining & 1
    remaining >>>= 1
  }
  return count
}
