import { z } from "zod"

import {
  addBeats,
  BeatNoteSchema,
  BeatSchema,
  compareBeats,
  MAX_BEAT_NOTES,
  PositiveBeatSchema,
  subtractBeats,
} from "./beat.ts"
import { NonNegativeIntegerSchema, PositiveIntegerSchema } from "./native.ts"

const ChoiceSchema = z
  .strictObject({
    panel_mask: NonNegativeIntegerSchema.max(0x03ff),
    hold: BeatSchema,
    weight: PositiveIntegerSchema.max(1_000_000),
  })
  .refine((choice) => choice.panel_mask !== 0 || choice.hold.numerator === 0, {
    message: "A rest cannot have hold duration",
  })
  .readonly()

export const BeatCycleRulesSchema = z
  .strictObject({
    start: BeatSchema,
    end: PositiveBeatSchema,
    step: PositiveBeatSchema,
    pattern: z
      .array(z.strictObject({ choices: z.array(ChoiceSchema).min(1).max(8).readonly() }).readonly())
      .min(1)
      .max(128)
      .readonly(),
  })
  .superRefine((rules, context) => {
    if (compareBeats(rules.start, rules.end) >= 0) {
      context.addIssue({ code: "custom", message: "Generation range must be nonempty" })
      return
    }
    if (beatCycleSlotCount(rules) > BigInt(MAX_BEAT_NOTES))
      context.addIssue({ code: "custom", message: "Generation range exceeds 10000 slots" })
  })
  .readonly()

export const BeatWeightedCycleRulesSchema = BeatCycleRulesSchema.unwrap()
  .extend({ schema_version: z.literal(1), algorithm: z.literal("weighted_cycle_v1") })
  .readonly()

export const BeatAutomaticRegionSchema = z
  .strictObject({
    id: z.uuid().brand("HybridRegionId"),
    name: z.string().trim().min(1).max(80),
    rules: BeatCycleRulesSchema,
  })
  .readonly()

export const BeatHybridRulesSchema = z
  .strictObject({
    schema_version: z.literal(2),
    algorithm: z.literal("hybrid_regions_v1"),
    fixed_notes: z.array(BeatNoteSchema).max(10_000).readonly(),
    regions: z.array(BeatAutomaticRegionSchema).max(64).readonly(),
  })
  .superRefine((rules, context) => {
    const ids = new Set<string>()
    let previousEnd: z.infer<typeof BeatSchema> | undefined
    let totalDemand = BigInt(rules.fixed_notes.length)
    for (const [index, region] of rules.regions.entries()) {
      if (ids.has(region.id))
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Region IDs must be unique",
        })
      ids.add(region.id)
      if (previousEnd !== undefined && compareBeats(region.rules.start, previousEnd) < 0)
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Automatic ranges overlap",
        })
      previousEnd = region.rules.end
      if (compareBeats(region.rules.start, region.rules.end) < 0)
        totalDemand += beatCycleSlotCount(region.rules)
      if (
        rules.fixed_notes.some(
          (note) =>
            compareBeats(note.at, region.rules.end) < 0 &&
            compareBeats(addBeats(note.at, note.hold), region.rules.start) >= 0,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Fixed notes intersect automatic ranges",
        })
    }
    if (totalDemand > BigInt(MAX_BEAT_NOTES))
      context.addIssue({ code: "custom", message: "Fixed notes and generated slots exceed 10000" })
  })
  .readonly()

export const BeatGenerationRulesSchema = z.discriminatedUnion("schema_version", [
  BeatWeightedCycleRulesSchema,
  BeatHybridRulesSchema,
])

export type BeatCycleRules = z.infer<typeof BeatCycleRulesSchema>
export type BeatGenerationRules = z.infer<typeof BeatGenerationRulesSchema>

export function beatCycleSlotCount(rules: {
  readonly start: z.infer<typeof BeatSchema>
  readonly end: z.infer<typeof BeatSchema>
  readonly step: z.infer<typeof PositiveBeatSchema>
}): bigint {
  const distance = subtractBeats(rules.end, rules.start)
  const numerator = BigInt(distance.numerator) * BigInt(rules.step.denominator)
  const denominator = BigInt(distance.denominator) * BigInt(rules.step.numerator)
  return (numerator + denominator - 1n) / denominator
}
