import { isJsonObject, schema } from "@slop-lab/part/contracts/index.js"
import type { Contracts } from "@slop-lab/part/reference/index.js"
import { z } from "zod"
import { BeatChartDocumentSchema } from "../../shared/beat-projects.ts"
import {
  EvaluationResponseSchema,
  NativeChartSchema,
  NativeMusicSchema,
} from "../../shared/index.ts"

export const EmptySchema = schema<Readonly<Record<string, never>>>(
  "pump-studio/empty",
  (value): value is Readonly<Record<string, never>> =>
    isJsonObject(value) && Object.keys(value).length === 0,
)
export const ProjectSchema = partSchema("pump-studio/project", BeatChartDocumentSchema)
export const EvaluationSchema = partSchema("pump-studio/evaluation", EvaluationResponseSchema)
export const ChartSchema = partSchema("pump-studio/chart", NativeChartSchema)
export const SeedInput = z.strictObject({ seed: z.string().regex(/^[0-9a-f]{64}$/) }).readonly()
export const SeedSchema = partSchema("pump-studio/seed", SeedInput)
export const ProposalInputZod = z
  .strictObject({
    summary: z.string().min(1).max(1_024),
    chart: NativeChartSchema,
    music: NativeMusicSchema.optional(),
  })
  .readonly()
export const ProposalSchema = partSchema("pump-studio/proposal", ProposalInputZod)
export const ProposalOutputSchema = partSchema(
  "pump-studio/proposal-output",
  z.strictObject({ proposal_id: z.string().min(1) }).readonly(),
)
export const UcsInputZod = z.strictObject({ mode: z.enum(["Single", "Double"]) }).readonly()
export const UcsInputSchema = partSchema("pump-studio/ucs-input", UcsInputZod)
export const UcsOutputSchema = partSchema(
  "pump-studio/ucs-output",
  z
    .strictObject({
      valid: z.literal(true),
      mode: z.enum(["Single", "Double"]),
      byte_length: z.number().int().nonnegative(),
    })
    .readonly(),
)
export const TextDeltaSchema = z.strictObject({ text: z.string() })

export const toolJsonSchemas = {
  read_document: objectSchema({}),
  evaluate_chart: objectSchema({}),
  generate_variant: objectSchema({ seed: { type: "string", pattern: "^[0-9a-f]{64}$" } }, ["seed"]),
  propose_chart: objectSchema(
    {
      summary: { type: "string", minLength: 1, maxLength: 1_024 },
      chart: chartJsonSchema(),
      music: {
        type: "object",
        description: "Optional complete NativeMusic replacement preserving audio_sha256.",
        additionalProperties: true,
      },
    },
    ["summary", "chart"],
  ),
  validate_ucs: objectSchema({ mode: { type: "string", enum: ["Single", "Double"] } }, ["mode"]),
} as const

export function partSchema<T>(id: string, validator: z.ZodType<T>): Contracts.Schema<T> {
  return schema(id, (value): value is T => validator.safeParse(value).success)
}

function objectSchema(
  properties: Readonly<Record<string, Contracts.Json>>,
  required: readonly string[] = [],
): Contracts.Json {
  return { type: "object", properties, required, additionalProperties: false }
}

function chartJsonSchema(): Contracts.Json {
  return {
    type: "object",
    required: ["ticks_per_beat", "span_ticks", "notes"],
    additionalProperties: false,
    properties: {
      ticks_per_beat: { type: "integer", minimum: 1, maximum: 4_096 },
      span_ticks: { type: "integer", minimum: 1, maximum: 1_000_000 },
      notes: {
        type: "array",
        maxItems: 10_000,
        items: {
          type: "object",
          required: ["tick", "panel_mask", "hold_ticks"],
          additionalProperties: false,
          properties: {
            tick: { type: "integer", minimum: 0 },
            panel_mask: { type: "integer", minimum: 1, maximum: 1_023 },
            hold_ticks: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  }
}
