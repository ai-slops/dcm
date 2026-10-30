import { functionTool } from "@slop-lab/part/tools.js"
import type { PartRuntimeOptions } from "./part-runtime.ts"
import { partSchema } from "./part-schemas.ts"
import {
  ApplyComponentInput,
  BaseSourcesSchema,
  ComponentListSchema,
  CreateProjectInput,
  GenerateProjectInput,
  GenerationProjectPartSchema,
  LibraryChartDocumentPartSchema,
  ListBaseSourcesInput,
  ListComponentsInput,
  ListProjectsInput,
  ListSongsInput,
  ProjectListSchema,
  ProjectMutationReceiptSchema,
  PublishComponentInput,
  ReadChartInput,
  ReadComponentInput,
  ReadProjectInput,
  ReusableComponentPartSchema,
  SongListSchema,
  WriteProjectInput,
} from "./project-tool-schemas.ts"
import { withTool } from "./tool-execution.ts"

export function createProjectToolBindings(
  options: PartRuntimeOptions & {
    readonly projectTools: NonNullable<PartRuntimeOptions["projectTools"]>
  },
) {
  const projects = options.projectTools
  return [
    functionTool({
      id: "list_projects",
      description: "List durable generation-project summaries and the selected project ID.",
      input: partSchema("pump-studio/list-projects-input", ListProjectsInput),
      output: ProjectListSchema,
      execute: withTool(options, "list_projects", () => projects.listProjects()),
    }),
    functionTool({
      id: "list_songs",
      description: "List durable song IDs and labels available for project creation.",
      input: partSchema("pump-studio/list-songs-input", ListSongsInput),
      output: SongListSchema,
      execute: withTool(options, "list_songs", () => projects.listSongs()),
    }),
    functionTool({
      id: "list_base_sources",
      description:
        "List server-issued exact base timing references for a song before project creation.",
      input: partSchema("pump-studio/list-base-sources-input", ListBaseSourcesInput),
      output: BaseSourcesSchema,
      execute: withTool(options, "list_base_sources", (input) => projects.listBaseSources(input)),
    }),
    functionTool({
      id: "read_project",
      description: "Read one live durable generation project by ID.",
      input: partSchema("pump-studio/read-project-input", ReadProjectInput),
      output: GenerationProjectPartSchema,
      execute: withTool(options, "read_project", (input) => projects.readProject(input)),
    }),
    functionTool({
      id: "read_chart",
      description: "Read one saved active or inactive chart document by chart ID.",
      input: partSchema("pump-studio/read-chart-input", ReadChartInput),
      output: LibraryChartDocumentPartSchema,
      execute: withTool(options, "read_chart", (input) => projects.readChart(input)),
    }),
    functionTool({
      id: "create_project",
      description: "Create a durable beat-native project with an explicit base timing reference.",
      input: partSchema("pump-studio/create-project-input", CreateProjectInput),
      output: ProjectMutationReceiptSchema,
      effects: "write",
      execute: withTool(options, "create_project", (input, signal) =>
        projects.createProject(input, signal),
      ),
    }),
    functionTool({
      id: "write_project",
      description: "Replace mutable rule details using the project's current base revision.",
      input: partSchema("pump-studio/write-project-input", WriteProjectInput),
      output: ProjectMutationReceiptSchema,
      effects: "write",
      execute: withTool(options, "write_project", (input, signal) =>
        projects.writeProject(input, signal),
      ),
    }),
    functionTool({
      id: "generate_project",
      description: "Generate and persist a new inactive result chart without changing the editor.",
      input: partSchema("pump-studio/generate-project-input", GenerateProjectInput),
      output: ProjectMutationReceiptSchema,
      effects: "write",
      execute: withTool(options, "generate_project", (input, signal) =>
        projects.generateProject(input, signal),
      ),
    }),
    functionTool({
      id: "publish_component",
      description:
        "Publish reusable project rules or a note_fragment from an exact start/end beat range.",
      input: partSchema("pump-studio/publish-component-input", PublishComponentInput),
      output: ProjectMutationReceiptSchema,
      effects: "write",
      execute: withTool(options, "publish_component", (input, signal) =>
        projects.publishComponent(input, signal),
      ),
    }),
    functionTool({
      id: "apply_component",
      description:
        "Apply a reusable component with compare-and-swap revision; note fragments require an exact insertion beat at.",
      input: partSchema("pump-studio/apply-component-input", ApplyComponentInput),
      output: ProjectMutationReceiptSchema,
      effects: "write",
      execute: withTool(options, "apply_component", (input, signal) =>
        projects.applyComponent(input, signal),
      ),
    }),
    functionTool({
      id: "list_components",
      description: "List durable reusable component summaries.",
      input: partSchema("pump-studio/list-components-input", ListComponentsInput),
      output: ComponentListSchema,
      execute: withTool(options, "list_components", () => projects.listComponents()),
    }),
    functionTool({
      id: "read_component",
      description: "Read one live reusable component by ID.",
      input: partSchema("pump-studio/read-component-input", ReadComponentInput),
      output: ReusableComponentPartSchema,
      execute: withTool(options, "read_component", (input) => projects.readComponent(input)),
    }),
  ]
}
