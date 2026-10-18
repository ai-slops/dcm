import { z } from "zod"

import type { EvaluationResponseSchema } from "./assessment.ts"
import { NativeChartSchema, NonNegativeIntegerSchema } from "./native.ts"
import { StudioProjectV1Schema } from "./project.ts"

export { ApiRoutes } from "./routes.ts"

export const RevisionSchema = NonNegativeIntegerSchema.brand("Revision")
export const SessionIdSchema = z.string().min(1).brand("SessionId")
export const ProposalIdSchema = z.string().min(1).brand("ProposalId")
export const AgentRunIdSchema = z.string().min(1).brand("AgentRunId")

export const CurrentDocumentSchema = z
  .strictObject({ revision: RevisionSchema, project: StudioProjectV1Schema })
  .readonly()

export const ChartProposalSchema = z
  .strictObject({
    id: ProposalIdSchema,
    base_revision: RevisionSchema,
    source: z.enum(["native_generate", "agent"]),
    summary: z.string().min(1).max(1_024),
    chart: NativeChartSchema,
  })
  .readonly()

export const AgentRunSnapshotSchema = z
  .strictObject({
    id: AgentRunIdSchema,
    base_revision: RevisionSchema,
    status: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
    prompt: z.string().min(1).max(16_384),
    last_sequence: NonNegativeIntegerSchema,
  })
  .readonly()

export const BootstrapSchema = z
  .strictObject({
    document: CurrentDocumentSchema,
    csrf_token: z.string().min(1),
    session_id: SessionIdSchema,
    native: z.strictObject({ ready: z.boolean(), message: z.string().min(1) }).readonly(),
    agent: z
      .strictObject({
        configured: z.boolean(),
        provider: z.string().nullable(),
        model: z.string().nullable(),
      })
      .readonly(),
    proposals: z.array(ChartProposalSchema).readonly().optional(),
    active_run: AgentRunSnapshotSchema.nullable().optional(),
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
      type: z.literal("status"),
      status: z.enum(["queued", "running", "cancelled"]),
    })
    .readonly(),
  z.strictObject({ ...AgentEventBase, type: z.literal("delta"), text: z.string() }).readonly(),
  z
    .strictObject({
      ...AgentEventBase,
      type: z.literal("tool"),
      tool_id: z.string().min(1),
      state: z.enum(["started", "completed"]),
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
  z.strictObject({ ...AgentEventBase, type: z.literal("completed"), text: z.string() }).readonly(),
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
