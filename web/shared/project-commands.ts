import { z } from "zod"

import { NativeAssessmentSchema } from "./assessment.ts"
import { BaseUcsRefSchema, BeatChartCoreSchema, BeatSchema, BeatTimingSchema } from "./beat.ts"
import { BeatEvaluationContractSchema } from "./beat-evaluation.ts"
import {
  BeatProjectWorkspaceSchema,
  BeatReusableComponentSchema,
  GenerationProjectV2Schema,
} from "./beat-projects.ts"
import { BeatGenerationRulesSchema } from "./beat-rules.ts"
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
  chart_artist: LibraryLabelSchema.nullable(),
  timing: BeatTimingSchema,
  evaluation_contract: BeatEvaluationContractSchema,
  generation_rules: BeatGenerationRulesSchema,
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
      base_ucs_ref: BaseUcsRefSchema,
      ...MutableProjectFields,
      chart_artist: LibraryLabelSchema,
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
      start: BeatSchema.optional(),
      end: BeatSchema.optional(),
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal("apply_component"),
      ...ProjectGuard,
      component_id: ComponentIdSchema,
      at: BeatSchema.optional(),
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

export const BeatRuleGenerationSchema = NativeRuleGenerationSchema.unwrap()
  .omit({ chart: true })
  .extend({ chart: BeatChartCoreSchema })
  .readonly()

export const ProjectGenerationResultSchema = BeatRuleGenerationSchema.unwrap()
  .extend({
    chart_id: ChartIdSchema,
    project_id: GenerationProjectIdSchema,
    project_revision: ProjectRevisionSchema,
    seed: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly()

export const ProjectMutationSchema = z
  .strictObject({
    workspace: BeatProjectWorkspaceSchema,
    project: GenerationProjectV2Schema.optional(),
    component: BeatReusableComponentSchema.optional(),
    generation: ProjectGenerationResultSchema.optional(),
  })
  .readonly()

export type ProjectCommand = z.infer<typeof ProjectCommandSchema>
export type NativeRuleGeneration = z.infer<typeof NativeRuleGenerationSchema>
export type BeatRuleGeneration = z.infer<typeof BeatRuleGenerationSchema>
export type ProjectGenerationResult = z.infer<typeof ProjectGenerationResultSchema>
export type ProjectMutation = z.infer<typeof ProjectMutationSchema>
