import { z } from "zod"

import {
  addBeats,
  BaseUcsRefSchema,
  BeatNoteSchema,
  BeatSchema,
  BeatTimingSchema,
  compareBeats,
  MAX_BEAT_NOTES,
} from "./beat.ts"
import { BeatEvaluationContractSchema } from "./beat-evaluation.ts"
import {
  validateBeatGenerationProject,
  validateBeatNotes,
  validateEvaluationDuration,
} from "./beat-project-validation.ts"
import { BeatGenerationRulesSchema } from "./beat-rules.ts"
import { NonNegativeIntegerSchema } from "./native.ts"
import { AudioAssetSchema, UcsModeSchema } from "./project.ts"
import {
  ComponentIdSchema,
  GenerationProjectIdSchema,
  MAX_GENERATION_PROJECTS,
  MAX_REUSABLE_COMPONENTS,
  ProjectRevisionSchema,
  WorkspaceRevisionSchema,
} from "./project-identities.ts"

const LibraryLabelSchema = z.string().trim().min(1).max(160)
const SongIdSchema = z.uuid().brand("SongId")

export const NoteFragmentV1Schema = z
  .strictObject({
    schema_version: z.literal(1),
    kind: z.literal("note_fragment_v1"),
    mode: UcsModeSchema,
    span: BeatSchema.refine((beat) => beat.numerator > 0, {
      message: "fragment span must be positive",
    }),
    notes: z.array(BeatNoteSchema).min(1).max(MAX_BEAT_NOTES).readonly(),
  })
  .superRefine((fragment, context) => {
    for (const [index, note] of fragment.notes.entries()) {
      const end = addBeats(note.at, note.hold)
      if (
        compareBeats(end, fragment.span) > 0 ||
        (note.hold.numerator === 0 && compareBeats(note.at, fragment.span) >= 0)
      )
        context.addIssue({
          code: "custom",
          path: ["notes", index],
          message: "note exceeds fragment span",
        })
      if (fragment.mode === "Single" && (note.panel_mask & ~0x001f) !== 0)
        context.addIssue({
          code: "custom",
          path: ["notes", index],
          message: "note exceeds Single lanes",
        })
    }
  })
  .readonly()

export const BeatChartDocumentSchema = z
  .strictObject({
    schema_version: z.literal(1),
    title: LibraryLabelSchema,
    artist: LibraryLabelSchema,
    chart_artist: LibraryLabelSchema.nullable(),
    mode: UcsModeSchema,
    timing: BeatTimingSchema,
    notes: z.array(BeatNoteSchema).max(MAX_BEAT_NOTES).readonly(),
    audio_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    audio_asset: AudioAssetSchema,
    evaluation_contract: BeatEvaluationContractSchema,
  })
  .superRefine((document, context) => {
    validateBeatNotes(document, context)
    validateEvaluationDuration(document.timing.duration, document.evaluation_contract, context)
  })
  .readonly()

export const BeatAutomaticRegionViewSchema = z
  .strictObject({
    id: z.uuid().brand("HybridRegionId"),
    name: z.string().trim().min(1).max(80),
    start: BeatSchema,
    end: BeatSchema,
  })
  .readonly()

export const BeatDocumentOriginSchema = z
  .strictObject({
    project_id: GenerationProjectIdSchema,
    project_revision: ProjectRevisionSchema,
    seed: z.string().regex(/^[0-9a-f]{64}$/),
    automatic_regions: z.array(BeatAutomaticRegionViewSchema).max(64).readonly(),
  })
  .readonly()

export const BeatCurrentDocumentSchema = z
  .strictObject({
    revision: NonNegativeIntegerSchema.brand("Revision"),
    project: BeatChartDocumentSchema,
    origin: BeatDocumentOriginSchema.optional(),
  })
  .readonly()

export const AppliedBeatComponentRefSchema = z
  .strictObject({
    component_id: ComponentIdSchema,
    component_revision: NonNegativeIntegerSchema,
    source_project_id: GenerationProjectIdSchema,
    source_project_revision: ProjectRevisionSchema,
  })
  .readonly()

const AppliedComponentsSchema = z
  .strictObject({
    timing: AppliedBeatComponentRefSchema.optional(),
    evaluation: AppliedBeatComponentRefSchema.optional(),
    generator: AppliedBeatComponentRefSchema.optional(),
    note_fragments: z.array(AppliedBeatComponentRefSchema).max(128).readonly().optional(),
  })
  .readonly()

const ProjectSummaryShape = {
  schema_version: z.literal(2),
  id: GenerationProjectIdSchema,
  revision: ProjectRevisionSchema,
  name: LibraryLabelSchema,
  song_id: SongIdSchema,
  mode: UcsModeSchema,
  chart_artist: LibraryLabelSchema.nullable(),
  base_ucs_ref: BaseUcsRefSchema.nullable(),
  applied_components: AppliedComponentsSchema,
} as const

export const GenerationProjectV2SummarySchema = z.strictObject(ProjectSummaryShape).readonly()
export const GenerationProjectV2Schema = z
  .strictObject({
    ...ProjectSummaryShape,
    timing: BeatTimingSchema,
    evaluation_contract: BeatEvaluationContractSchema,
    generation_rules: BeatGenerationRulesSchema,
  })
  .superRefine((project, context) => validateBeatGenerationProject(project, context))
  .readonly()

const ComponentSummaryShape = {
  id: ComponentIdSchema,
  revision: NonNegativeIntegerSchema,
  name: LibraryLabelSchema,
  source_project_id: GenerationProjectIdSchema,
  source_project_revision: ProjectRevisionSchema,
} as const

export const BeatReusableComponentSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({ ...ComponentSummaryShape, kind: z.literal("timing"), value: BeatTimingSchema })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("evaluation"),
      value: BeatEvaluationContractSchema,
    })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("generator"),
      value: BeatGenerationRulesSchema,
    })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("note_fragment"),
      value: NoteFragmentV1Schema,
    })
    .readonly(),
  z
    .strictObject({
      ...ComponentSummaryShape,
      kind: z.literal("legacy_unresolved"),
      original_kind: z.enum(["evaluation", "generator"]),
      legacy_value: z.unknown(),
      read_only_reason: z.literal("legacy_component_basis_missing"),
    })
    .readonly(),
])

export const BeatProjectWorkspaceSchema = z
  .strictObject({
    revision: WorkspaceRevisionSchema,
    selected_project_id: GenerationProjectIdSchema.nullable(),
    projects: z.array(GenerationProjectV2SummarySchema).max(MAX_GENERATION_PROJECTS).readonly(),
    components: z.array(BeatReusableComponentSchema).max(MAX_REUSABLE_COMPONENTS).readonly(),
  })
  .readonly()

export const BaseUcsSourceOptionSchema = z
  .strictObject({
    ref: BaseUcsRefSchema,
    label: LibraryLabelSchema,
    mode: UcsModeSchema,
    timing: BeatTimingSchema,
  })
  .readonly()

export const BaseUcsSourceOptionsSchema = z.array(BaseUcsSourceOptionSchema).max(160).readonly()

export type NoteFragmentV1 = z.infer<typeof NoteFragmentV1Schema>
export type BeatChartDocument = z.infer<typeof BeatChartDocumentSchema>
export type BeatDocumentOrigin = z.infer<typeof BeatDocumentOriginSchema>
export type BeatCurrentDocument = z.infer<typeof BeatCurrentDocumentSchema>
export type GenerationProjectV2 = z.infer<typeof GenerationProjectV2Schema>
export type BeatReusableComponent = z.infer<typeof BeatReusableComponentSchema>
export type BeatProjectWorkspace = z.infer<typeof BeatProjectWorkspaceSchema>
export type BaseUcsSourceOption = z.infer<typeof BaseUcsSourceOptionSchema>
