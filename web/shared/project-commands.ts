import { z } from "zod"

import { NativeAssessmentSchema } from "./assessment.ts"
import { EvalContractSchema } from "./evaluation-contract.ts"
import {
  GenerationProjectSchema,
  MusicTimingSchema,
  ProjectWorkspaceSchema,
  ReusableComponentSchema,
} from "./generation-projects.ts"
import { GenerationRulesSchema } from "./generation-rules.ts"
import { ChartIdSchema, LibraryLabelSchema, SongIdSchema } from "./library.ts"
import { NativeChartSchema, NonNegativeIntegerSchema } from "./native.ts"
import { UcsModeSchema } from "./project.ts"
import {
  ComponentIdSchema,
  ComponentKindSchema,
  GenerationProjectIdSchema,
  ProjectRevisionSchema,
} from "./project-identities.ts"

const MutableProjectFields = {
  name: LibraryLabelSchema,
  timing: MusicTimingSchema,
  evaluation_contract: EvalContractSchema,
  generation_rules: GenerationRulesSchema,
} as const
const ProjectGuard = {
  project_id: GenerationProjectIdSchema,
  base_revision: ProjectRevisionSchema,
} as const
export const ProjectCommandSchema = z.discriminatedUnion("type", [
  z
    .strictObject({
      type: z.literal("create_project"),
      song_id: SongIdSchema,
      mode: UcsModeSchema,
      ...MutableProjectFields,
    })
    .readonly(),
  z
    .strictObject({ type: z.literal("write_project"), ...ProjectGuard, ...MutableProjectFields })
    .readonly(),
  z
    .strictObject({
      type: z.literal("select_project"),
      project_id: GenerationProjectIdSchema.nullable(),
    })
    .readonly(),
  z.strictObject({ type: z.literal("delete_project"), ...ProjectGuard }).readonly(),
  z
    .strictObject({
      type: z.literal("publish_component"),
      ...ProjectGuard,
      kind: ComponentKindSchema,
      name: LibraryLabelSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("apply_component"),
      ...ProjectGuard,
      component_id: ComponentIdSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("delete_component"),
      component_id: ComponentIdSchema,
      base_revision: NonNegativeIntegerSchema,
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("generate_project"),
      ...ProjectGuard,
      name: LibraryLabelSchema,
      seed: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .readonly(),
])

export const NativeRuleGenerationSchema = z
  .strictObject({
    schema_version: z.literal(1),
    mode: UcsModeSchema,
    chart: NativeChartSchema,
    assessment: NativeAssessmentSchema,
    ucs_validation: z
      .strictObject({
        valid: z.boolean(),
        byte_length: NonNegativeIntegerSchema.optional(),
        error: z.string().min(1).max(1024).optional(),
      })
      .readonly(),
    request_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    certification: z
      .strictObject({
        status: z.literal("none"),
        reason: z.literal("not_generated_from_verified_bundle"),
      })
      .readonly(),
  })
  .readonly()

export const ProjectGenerationResultSchema = NativeRuleGenerationSchema.unwrap()
  .extend({
    chart_id: ChartIdSchema,
    project_id: GenerationProjectIdSchema,
    project_revision: ProjectRevisionSchema,
    seed: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly()

export const ProjectMutationSchema = z
  .strictObject({
    workspace: ProjectWorkspaceSchema,
    project: GenerationProjectSchema.optional(),
    component: ReusableComponentSchema.optional(),
    generation: ProjectGenerationResultSchema.optional(),
  })
  .readonly()

export type ProjectCommand = z.infer<typeof ProjectCommandSchema>
export type NativeRuleGeneration = z.infer<typeof NativeRuleGenerationSchema>
export type ProjectGenerationResult = z.infer<typeof ProjectGenerationResultSchema>
export type ProjectMutation = z.infer<typeof ProjectMutationSchema>
