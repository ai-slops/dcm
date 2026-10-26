import { z } from "zod"

import type { EvaluationResponseSchema } from "./assessment.ts"
import { NativeChartSchema, NativeMusicSchema, NonNegativeIntegerSchema } from "./native.ts"
import { StudioProjectV1Schema } from "./project.ts"
import { AgentProviderStatusSchema, ProviderApiSchema } from "./provider.ts"
import { MAX_AGENT_DELTA_BYTES, MAX_AGENT_TEXT_BYTES } from "./text.ts"

export { ApiRoutes } from "./routes.ts"

export const RevisionSchema = NonNegativeIntegerSchema.brand("Revision")
export const SessionIdSchema = z.string().min(1).brand("SessionId")
export const ProposalIdSchema = z.string().min(1).brand("ProposalId")
export const AgentRunIdSchema = z.string().min(1).brand("AgentRunId")
export const MAX_SESSION_PROPOSALS = 16

const AgentTextSchema = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_AGENT_TEXT_BYTES)
const AgentDeltaSchema = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_AGENT_DELTA_BYTES)

export const CurrentDocumentSchema = z
  .strictObject({ revision: RevisionSchema, project: StudioProjectV1Schema })
  .readonly()

export const ChartProposalSchema = z
  .strictObject({
    id: ProposalIdSchema,
    base_revision: RevisionSchema,
    source: z.enum(["native_generate", "agent"]),
    run_id: AgentRunIdSchema.optional(),
    summary: z.string().min(1).max(1_024),
    chart: NativeChartSchema,
    music: NativeMusicSchema.optional(),
    before: z
      .strictObject({ chart: NativeChartSchema, music: NativeMusicSchema })
      .readonly()
      .optional(),
    changes: z
      .strictObject({
        notes_added: NonNegativeIntegerSchema,
        notes_removed: NonNegativeIntegerSchema,
        timing_changed: z.boolean(),
        offset_before: z.number().int().safe(),
        offset_after: z.number().int().safe(),
        tick_start: NonNegativeIntegerSchema.optional(),
        tick_end: NonNegativeIntegerSchema.optional(),
        lanes: z.array(NonNegativeIntegerSchema.max(9)).max(10).readonly(),
      })
      .readonly()
      .optional(),
  })
  .readonly()

const PreviewSchema = z.string().max(8_192)
const AgentToolErrorSchema = z
  .strictObject({ code: z.string().min(1).max(128), message: z.string().min(1).max(1_024) })
  .readonly()
const AgentToolCallSchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    tool_id: z.string().min(1).max(128),
    state: z.enum(["started", "completed", "failed"]),
    input_preview: PreviewSchema,
    output_preview: PreviewSchema.optional(),
    error: AgentToolErrorSchema.optional(),
    truncated: z.boolean().optional(),
  })
  .readonly()
const ProposalDecisionSchema = z
  .strictObject({
    id: ProposalIdSchema,
    status: z.enum(["applied", "rejected"]),
    revision: RevisionSchema.optional(),
    summary: z.string().min(1).max(1_024),
  })
  .readonly()

export const AgentRunSnapshotSchema = z
  .strictObject({
    id: AgentRunIdSchema,
    base_revision: RevisionSchema,
    status: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
    prompt: z.string().min(1).max(16_384),
    last_sequence: NonNegativeIntegerSchema,
    text: AgentTextSchema.optional(),
    text_truncated: z.boolean().optional(),
    model: z.string().min(1).max(200).optional(),
    api: ProviderApiSchema.optional(),
    error: AgentToolErrorSchema.optional(),
    tool_calls: z.array(AgentToolCallSchema).max(64).readonly().optional(),
    proposal_decisions: z.array(ProposalDecisionSchema).max(16).readonly().optional(),
  })
  .readonly()

export const BootstrapSchema = z
  .strictObject({
    document: CurrentDocumentSchema,
    csrf_token: z.string().min(1),
    session_id: SessionIdSchema,
    native: z.strictObject({ ready: z.boolean(), message: z.string().min(1) }).readonly(),
    agent: AgentProviderStatusSchema,
    tools: z
      .array(
        z
          .strictObject({
            id: z.string().min(1).max(128),
            description: z.string().min(1).max(1_024),
            available: z.boolean(),
            reason: z.string().min(1).max(1_024).optional(),
          })
          .readonly(),
      )
      .max(16)
      .readonly()
      .optional(),
    proposals: z.array(ChartProposalSchema).max(MAX_SESSION_PROPOSALS).readonly().optional(),
    active_run: AgentRunSnapshotSchema.nullable().optional(),
    recent_runs: z.array(AgentRunSnapshotSchema).max(32).readonly().optional(),
  })
  .readonly()

export const ApiErrorSchema = z
  .strictObject({
    error: z
      .strictObject({
        code: z.string().min(1),
        message: z.string().min(1),
        current_revision: RevisionSchema.optional(),
      })
      .readonly(),
  })
  .readonly()

export const BaseRevisionRequestSchema = z
  .strictObject({ base_revision: RevisionSchema })
  .readonly()

export const PutDocumentRequestSchema = z
  .strictObject({ base_revision: RevisionSchema, project: StudioProjectV1Schema })
  .readonly()

export const GenerationRequestSchema = z
  .strictObject({
    base_revision: RevisionSchema,
    seed: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly()

export const AgentRunRequestSchema = z
  .strictObject({
    base_revision: RevisionSchema,
    prompt: z.string().trim().min(1).max(16_384),
    model_id: z.string().min(1).max(200).optional(),
  })
  .readonly()

const AgentEventBase = {
  run_id: AgentRunIdSchema,
  sequence: NonNegativeIntegerSchema,
} as const

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("snapshot"),
      snapshot: AgentRunSnapshotSchema,
    })
    .readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("status"),
      status: z.enum(["queued", "running", "cancelled"]),
    })
    .readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("delta"),
      text: AgentDeltaSchema,
      truncated: z.boolean().optional(),
    })
    .readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("tool"),
      tool_id: z.string().min(1),
      call_id: z.string().min(1).max(256).optional(),
      state: z.enum(["started", "completed", "failed"]),
      input_preview: PreviewSchema.optional(),
      output_preview: PreviewSchema.optional(),
      error: AgentToolErrorSchema.optional(),
      truncated: z.boolean().optional(),
    })
    .readonly(),
  z
    .strictObject({ ...AgentEventBase, type: z.literal("proposal"), proposal: ChartProposalSchema })
    .readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("completed"),
      text: AgentTextSchema,
      truncated: z.boolean().optional(),
    })
    .readonly(),
])

export type Revision = z.infer<typeof RevisionSchema>
export type CurrentDocument = z.infer<typeof CurrentDocumentSchema>
export type ChartProposal = z.infer<typeof ChartProposalSchema>
export type Bootstrap = z.infer<typeof BootstrapSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>
export type EvaluationApiResponse = z.infer<typeof EvaluationResponseSchema>
export type BaseRevisionRequest = z.infer<typeof BaseRevisionRequestSchema>
export type PutDocumentRequest = z.infer<typeof PutDocumentRequestSchema>
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>
