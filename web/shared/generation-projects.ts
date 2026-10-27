import { z } from "zod"

import { EvalContractSchema } from "./evaluation-contract.ts"
import { GenerationRulesSchema } from "./generation-rules.ts"
import { LibraryLabelSchema, SongIdSchema } from "./library.ts"
import { NativeMusicSchema, NonNegativeIntegerSchema } from "./native.ts"
import { StudioProjectV1Schema, UcsModeSchema } from "./project.ts"
import {
  ComponentIdSchema,
  ComponentKindSchema,
  GenerationProjectIdSchema,
  MAX_GENERATION_PROJECTS,
  MAX_REUSABLE_COMPONENTS,
  ProjectRevisionSchema,
  WorkspaceRevisionSchema,
} from "./project-identities.ts"

const { audio_sha256: _audioDigest, ...timingShape } = NativeMusicSchema.unwrap().shape
export const MusicTimingSchema = z
  .strictObject(timingShape)
  .superRefine((timing, context) => {
    const parsed = NativeMusicSchema.safeParse({
      ...timing,
      audio_sha256: Array.from({ length: 32 }, () => 0),
    })
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", message: issue.message, path: issue.path })
  })
  .readonly()

export const AppliedComponentRefSchema = z
  .strictObject({
    component_id: ComponentIdSchema,
    component_revision: NonNegativeIntegerSchema,
    source_project_id: GenerationProjectIdSchema,
    source_project_revision: ProjectRevisionSchema,
  })
  .readonly()

const ProjectSummaryShape = {
  schema_version: z.literal(1),
  id: GenerationProjectIdSchema,
  revision: ProjectRevisionSchema,
  name: LibraryLabelSchema,
  song_id: SongIdSchema,
  mode: UcsModeSchema,
  applied_components: z
    .strictObject({
      timing: AppliedComponentRefSchema.optional(),
      evaluation: AppliedComponentRefSchema.optional(),
      generator: AppliedComponentRefSchema.optional(),
    })
    .readonly(),
} as const

export const GenerationProjectSummarySchema = z.strictObject(ProjectSummaryShape).readonly()
export const GenerationProjectSchema = z
  .strictObject({
    ...ProjectSummaryShape,
    timing: MusicTimingSchema,
    evaluation_contract: EvalContractSchema,
    generation_rules: GenerationRulesSchema,
  })
  .superRefine((project, context) => {
    const bound = StudioProjectV1Schema.safeParse({
      schema_version: 1,
      title: "Rule project",
      artist: "Rule project",
      chart: {
        ticks_per_beat: project.timing.ticks_per_beat,
        span_ticks: project.timing.duration_ticks,
        notes: [],
      },
      music: { ...project.timing, audio_sha256: Array.from({ length: 32 }, () => 0) },
      evaluation_contract: project.evaluation_contract,
      audio_asset: { format: "wav", byte_length: 0 },
      ucs_mode: project.mode,
    })
    if (!bound.success)
      for (const issue of bound.error.issues)
        context.addIssue({ code: "custom", message: issue.message, path: issue.path })
    const rules = project.generation_rules
    if (rules.end_tick > project.timing.duration_ticks)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "end_tick"],
        message: "Generation range exceeds project timing",
      })
    const slots = Math.ceil((rules.end_tick - rules.start_tick) / rules.step_ticks)
    for (const [index, frame] of rules.pattern.entries()) {
      for (const choice of frame.choices) {
        if (project.mode === "Single" && (choice.panel_mask & ~0x001f) !== 0)
          context.addIssue({
            code: "custom",
            path: ["generation_rules", "pattern", index],
            message: "Single projects allow only five left-pad lanes",
          })
        if (index >= slots || choice.hold_ticks === 0) continue
        const lastSlot =
          index + Math.floor((slots - 1 - index) / rules.pattern.length) * rules.pattern.length
        if (
          rules.start_tick + lastSlot * rules.step_ticks + choice.hold_ticks >=
          project.timing.duration_ticks
        )
          context.addIssue({
            code: "custom",
            path: ["generation_rules", "pattern", index],
            message: "A hold tail must precede the project end for UCS export",
          })
      }
    }
  })
  .readonly()

const ComponentSummaryShape = {
  id: ComponentIdSchema,
  revision: NonNegativeIntegerSchema,
  name: LibraryLabelSchema,
  kind: ComponentKindSchema,
  source_project_id: GenerationProjectIdSchema,
  source_project_revision: ProjectRevisionSchema,
} as const

export const ReusableComponentSummarySchema = z.strictObject(ComponentSummaryShape).readonly()
export const ReusableComponentSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({ ...ComponentSummaryShape, kind: z.literal("timing"), value: MusicTimingSchema })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("evaluation"),
      value: EvalContractSchema,
    })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("generator"),
      value: GenerationRulesSchema,
    })
    .readonly(),
])

export const ProjectWorkspaceSchema = z
  .strictObject({
    revision: WorkspaceRevisionSchema,
    selected_project_id: GenerationProjectIdSchema.nullable(),
    projects: z.array(GenerationProjectSummarySchema).max(MAX_GENERATION_PROJECTS).readonly(),
    components: z.array(ReusableComponentSummarySchema).max(MAX_REUSABLE_COMPONENTS).readonly(),
  })
  .readonly()

export type MusicTiming = z.infer<typeof MusicTimingSchema>
export type GenerationProject = z.infer<typeof GenerationProjectSchema>
export type GenerationProjectSummary = z.infer<typeof GenerationProjectSummarySchema>
export type ReusableComponent = z.infer<typeof ReusableComponentSchema>
export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>
