import { z } from "zod"

import { BeatSchema, PositiveBeatSchema } from "./beat.ts"
import { NonNegativeIntegerSchema, PositiveIntegerSchema } from "./native.ts"

const MAX_RULES = 4_096
const MAX_EVAL_WORK = 100_000_000
const MAX_NATIVE_NOTES = 65_536
const MAX_NATIVE_FRAMES = 131_072

const MetricRangeSchema = z
  .strictObject({ minimum: NonNegativeIntegerSchema, maximum: NonNegativeIntegerSchema })
  .refine((range) => range.minimum <= range.maximum, { message: "minimum exceeds maximum" })
  .readonly()

export const BeatEvaluationContractSchema = z
  .strictObject({
    schema_version: z.literal(2),
    history_policy: z
      .strictObject({
        recent_window: NonNegativeIntegerSchema.max(256),
        max_request_history: NonNegativeIntegerSchema.max(256),
      })
      .refine((policy) => policy.recent_window <= policy.max_request_history, {
        message: "recent window exceeds history bound",
      })
      .readonly(),
    foot_model: z
      .strictObject({
        version: z.literal(1),
        micros_per_panel_unit: PositiveIntegerSchema,
        bracket_setup_micros: PositiveIntegerSchema,
        crossover_penalty: NonNegativeIntegerSchema,
        bracket_penalty: NonNegativeIntegerSchema,
      })
      .readonly(),
    difficulty: z
      .strictObject({
        label: z.string().min(1).max(256),
        density: MetricRangeSchema,
        movement: MetricRangeSchema,
        brackets: MetricRangeSchema,
        hold_occupancy: MetricRangeSchema,
        local_load: MetricRangeSchema,
        total: MetricRangeSchema,
        local_windows: z
          .array(
            z
              .strictObject({ width: PositiveBeatSchema, maximum_load: NonNegativeIntegerSchema })
              .readonly(),
          )
          .max(MAX_RULES)
          .readonly(),
      })
      .readonly(),
    intents: z
      .array(
        z
          .strictObject({
            id: z.string().min(1).max(256),
            kind: z.discriminatedUnion("kind", [
              z
                .strictObject({ kind: z.literal("reference_accents"), tolerance: BeatSchema })
                .readonly(),
              z
                .strictObject({
                  kind: z.literal("negative_space"),
                  start: BeatSchema,
                  end: PositiveBeatSchema,
                })
                .refine((rule) => compare(rule.start, rule.end) < 0, {
                  message: "negative-space range is empty",
                })
                .readonly(),
              z
                .strictObject({
                  kind: z.literal("relational_motif"),
                  minimum_notes: PositiveIntegerSchema.min(2).max(MAX_NATIVE_NOTES),
                  mirror_equivalent: z.boolean(),
                })
                .readonly(),
            ]),
            requiredness: z.enum(["required", "optional"]),
            credit_policy: z.enum(["exclusive", "shared"]),
            threshold: PositiveIntegerSchema,
            weight: PositiveIntegerSchema,
          })
          .readonly(),
      )
      .max(MAX_RULES)
      .readonly(),
    budgets: z
      .strictObject({
        max_notes: PositiveIntegerSchema.max(MAX_NATIVE_NOTES),
        max_frames: PositiveIntegerSchema.max(MAX_NATIVE_FRAMES),
        max_dp_work: PositiveIntegerSchema.max(MAX_EVAL_WORK),
        max_matching_work: PositiveIntegerSchema.max(MAX_EVAL_WORK),
      })
      .readonly(),
  })
  .superRefine((contract, context) => {
    if (contract.intents.length > contract.budgets.max_matching_work)
      context.addIssue({
        code: "custom",
        path: ["intents"],
        message: "intent count exceeds matching-work budget",
      })
    const ids = new Set<string>()
    for (const [index, intent] of contract.intents.entries()) {
      if (ids.has(intent.id))
        context.addIssue({
          code: "custom",
          path: ["intents", index, "id"],
          message: "intent ID is duplicated",
        })
      ids.add(intent.id)
      if (
        intent.kind.kind === "relational_motif" &&
        intent.kind.minimum_notes > contract.budgets.max_notes
      )
        context.addIssue({
          code: "custom",
          path: ["intents", index],
          message: "intent exceeds note budget",
        })
    }
  })
  .readonly()

export type BeatEvaluationContract = z.infer<typeof BeatEvaluationContractSchema>

function compare(left: z.infer<typeof BeatSchema>, right: z.infer<typeof BeatSchema>): number {
  const leftScaled = BigInt(left.numerator) * BigInt(right.denominator)
  const rightScaled = BigInt(right.numerator) * BigInt(left.denominator)
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0
}
