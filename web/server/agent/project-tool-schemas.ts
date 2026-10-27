import { jsonSchema } from "@slop-lab/part/contracts/index.js"
import type { Contracts } from "@slop-lab/part/reference/index.js"
import { z } from "zod"

import { EvalContractSchema } from "../../shared/evaluation-contract.ts"
import {
  GenerationProjectSchema,
  GenerationProjectSummarySchema,
  MusicTimingSchema,
  ReusableComponentSchema,
  ReusableComponentSummarySchema,
} from "../../shared/generation-projects.ts"
import { GenerationRulesSchema } from "../../shared/generation-rules.ts"
import {
  ChartIdSchema,
  LibraryChartDocumentSchema,
  LibraryLabelSchema,
  SongIdSchema,
} from "../../shared/library.ts"
import { UcsModeSchema } from "../../shared/project.ts"
import {
  ComponentIdSchema,
  ComponentKindSchema,
  GenerationProjectIdSchema,
  ProjectRevisionSchema,
} from "../../shared/project-identities.ts"
import { partSchema } from "./part-schemas.ts"

const mutableFields = {
  name: LibraryLabelSchema,
  timing: MusicTimingSchema,
  evaluation_contract: EvalContractSchema,
  generation_rules: GenerationRulesSchema,
} as const
const projectGuard = {
  project_id: GenerationProjectIdSchema,
  base_revision: ProjectRevisionSchema,
} as const

export const ListProjectsInput = z.strictObject({}).readonly()
export const ReadProjectInput = z.strictObject({ project_id: GenerationProjectIdSchema }).readonly()
export const ListSongsInput = ListProjectsInput
export const ReadChartInput = z.strictObject({ chart_id: ChartIdSchema }).readonly()
export const CreateProjectInput = z
  .strictObject({ song_id: SongIdSchema, mode: UcsModeSchema, ...mutableFields })
  .readonly()
export const WriteProjectInput = z.strictObject({ ...projectGuard, ...mutableFields }).readonly()
export const GenerateProjectInput = z
  .strictObject({
    ...projectGuard,
    name: LibraryLabelSchema,
    seed: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly()
export const PublishComponentInput = z
  .strictObject({ ...projectGuard, kind: ComponentKindSchema, name: LibraryLabelSchema })
  .readonly()
export const ApplyComponentInput = z
  .strictObject({ ...projectGuard, component_id: ComponentIdSchema })
  .readonly()
export const ListComponentsInput = ListProjectsInput
export const ReadComponentInput = z.strictObject({ component_id: ComponentIdSchema }).readonly()

const ProjectListOutput = z
  .strictObject({
    workspace_revision: z.number().int().nonnegative(),
    selected_project_id: GenerationProjectIdSchema.nullable(),
    projects: z.array(GenerationProjectSummarySchema).max(64).readonly(),
  })
  .readonly()
const ComponentListOutput = z
  .strictObject({
    workspace_revision: z.number().int().nonnegative(),
    components: z.array(ReusableComponentSummarySchema).max(128).readonly(),
  })
  .readonly()
const PersistedReceiptShape = {
  status: z.literal("persisted"),
  workspace_revision: z.number().int().nonnegative(),
} as const
const MutationReceiptOutput = z.union([
  z
    .strictObject({
      ...PersistedReceiptShape,
      entity: z
        .strictObject({
          kind: z.enum(["project", "component"]),
          id: z.string().min(1).max(128),
          revision: z.number().int().nonnegative(),
        })
        .readonly(),
    })
    .readonly(),
  z
    .strictObject({
      ...PersistedReceiptShape,
      entity: z.strictObject({ kind: z.literal("chart"), id: ChartIdSchema }).readonly(),
      generation: z
        .strictObject({
          accepted: z.boolean(),
          rejection_count: z.number().int().nonnegative(),
          mode: UcsModeSchema,
          note_count: z.number().int().nonnegative().max(100_000),
          request_sha256: z.string().regex(/^[0-9a-f]{64}$/),
          source_project_id: GenerationProjectIdSchema,
          source_project_revision: ProjectRevisionSchema,
          seed: z.string().regex(/^[0-9a-f]{64}$/),
          certification: z
            .strictObject({
              status: z.literal("none"),
              reason: z.literal("not_generated_from_verified_bundle"),
            })
            .readonly(),
        })
        .readonly(),
    })
    .readonly(),
])
const SongListOutput = z
  .strictObject({
    songs: z
      .array(
        z
          .strictObject({ id: SongIdSchema, title: LibraryLabelSchema, artist: LibraryLabelSchema })
          .readonly(),
      )
      .max(64)
      .readonly(),
  })
  .readonly()

export const ProjectListSchema = partSchema("pump-studio/project-list", ProjectListOutput)
export const SongListSchema = partSchema("pump-studio/song-list", SongListOutput)
export const LibraryChartDocumentPartSchema = partSchema(
  "pump-studio/library-chart-document",
  LibraryChartDocumentSchema,
)
export const GenerationProjectPartSchema = partSchema(
  "pump-studio/generation-project",
  GenerationProjectSchema,
)
export const ComponentListSchema = partSchema("pump-studio/component-list", ComponentListOutput)
export const ReusableComponentPartSchema = partSchema(
  "pump-studio/reusable-component",
  ReusableComponentSchema,
)
export const ProjectMutationReceiptSchema = partSchema(
  "pump-studio/project-mutation-receipt",
  MutationReceiptOutput,
)

export const projectToolJsonSchemas = {
  list_projects: toPartJsonSchema(ListProjectsInput),
  read_project: toPartJsonSchema(ReadProjectInput),
  list_songs: toPartJsonSchema(ListSongsInput),
  read_chart: toPartJsonSchema(ReadChartInput),
  create_project: toPartJsonSchema(CreateProjectInput),
  write_project: toPartJsonSchema(WriteProjectInput),
  generate_project: toPartJsonSchema(GenerateProjectInput),
  publish_component: toPartJsonSchema(PublishComponentInput),
  apply_component: toPartJsonSchema(ApplyComponentInput),
  list_components: toPartJsonSchema(ListComponentsInput),
  read_component: toPartJsonSchema(ReadComponentInput),
} as const

function toPartJsonSchema(input: z.ZodType): Contracts.Json {
  const plain: unknown = JSON.parse(JSON.stringify(z.toJSONSchema(input, { target: "draft-7" })))
  const checked = jsonSchema.validate(plain)
  if (!checked.ok) throw new TypeError("Zod emitted an invalid Part JSON schema")
  return checked.value
}
