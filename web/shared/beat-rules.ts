import { z } from "zod"

import { addBeats, BeatNoteSchema, BeatSchema, compareBeats, PositiveBeatSchema } from "./beat.ts"
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
  .refine((rules) => compareBeats(rules.start, rules.end) < 0, {
    message: "Generation range must be nonempty",
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
  })
  .readonly()

export const BeatGenerationRulesSchema = z.discriminatedUnion("schema_version", [
  BeatWeightedCycleRulesSchema,
  BeatHybridRulesSchema,
])

export type BeatCycleRules = z.infer<typeof BeatCycleRulesSchema>
export type BeatGenerationRules = z.infer<typeof BeatGenerationRulesSchema>
