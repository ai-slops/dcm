import { z } from "zod"

import {
  NativeChartSchema,
  NativeNoteSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from "./native.ts"
import { ucsCellConflict } from "./ucs-cells.ts"

const CycleFields = {
  start_tick: NonNegativeIntegerSchema.max(999_999),
  end_tick: PositiveIntegerSchema.max(1_000_000),
  step_ticks: PositiveIntegerSchema.max(1_000_000),
  pattern: z
    .array(
      z
        .strictObject({
          choices: z
            .array(
              z
                .strictObject({
                  panel_mask: NonNegativeIntegerSchema.max(0x03ff),
                  hold_ticks: NonNegativeIntegerSchema.max(1_000_000),
                  weight: PositiveIntegerSchema.max(1_000_000),
                })
                .refine((choice) => choice.panel_mask !== 0 || choice.hold_ticks === 0, {
                  message: "A rest cannot have hold duration",
                })
                .readonly(),
            )
            .min(1)
            .max(8)
            .readonly(),
        })
        .readonly(),
    )
    .min(1)
    .max(128)
    .readonly(),
} as const

function checkCycle(
  rules: { readonly start_tick: number; readonly end_tick: number; readonly step_ticks: number },
  context: z.RefinementCtx,
): void {
  if (rules.end_tick <= rules.start_tick)
    context.addIssue({ code: "custom", message: "Generation range must be nonempty" })
  if (Math.ceil((rules.end_tick - rules.start_tick) / rules.step_ticks) > 10_000)
    context.addIssue({ code: "custom", message: "Generation exceeds the 10000-slot limit" })
}

export const CycleRulesSchema = z.strictObject(CycleFields).superRefine(checkCycle).readonly()
export const WeightedCycleRulesSchema = z
  .strictObject({
    schema_version: z.literal(1),
    algorithm: z.literal("weighted_cycle_v1"),
    ...CycleFields,
  })
  .superRefine(checkCycle)
  .readonly()

export const HybridRegionIdSchema = z
  .uuid()
  .refine((id) => id === id.toLowerCase(), {
    message: "Region IDs must be canonical lowercase UUIDs",
  })
  .brand("HybridRegionId")
export const AutomaticRegionSchema = z
  .strictObject({
    id: HybridRegionIdSchema,
    name: z.string().trim().min(1).max(80),
    rules: CycleRulesSchema,
  })
  .readonly()
export const AutomaticRegionViewSchema = z
  .strictObject({
    id: HybridRegionIdSchema,
    name: z.string().trim().min(1).max(80),
    start_tick: NonNegativeIntegerSchema.max(999_999),
    end_tick: PositiveIntegerSchema.max(1_000_000),
  })
  .refine((region) => region.start_tick < region.end_tick, {
    message: "Automatic range must be nonempty",
  })
  .readonly()

export const HybridRulesSchema = z
  .strictObject({
    schema_version: z.literal(2),
    algorithm: z.literal("hybrid_regions_v1"),
    fixed_notes: z.array(NativeNoteSchema).max(10_000).readonly(),
    regions: z.array(AutomaticRegionSchema).max(64).readonly(),
  })
  .superRefine((rules, context) => {
    const fixed = NativeChartSchema.safeParse({
      ticks_per_beat: 1,
      span_ticks: 1_000_000,
      notes: rules.fixed_notes,
    })
    if (!fixed.success)
      context.addIssue({
        code: "custom",
        path: ["fixed_notes"],
        message: "Fixed notes must be canonical and nonoverlapping",
      })
    if (ucsCellConflict(rules.fixed_notes) !== null)
      context.addIssue({
        code: "custom",
        path: ["fixed_notes"],
        message: "Fixed notes cannot share UCS cells, including hold tails",
      })
    const ids = new Set<string>()
    let previousEnd = 0
    let slots = rules.fixed_notes.length
    for (const [index, region] of rules.regions.entries()) {
      if (ids.has(region.id))
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Region IDs must be unique",
        })
      ids.add(region.id)
      if (region.rules.start_tick < previousEnd)
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Automatic ranges must be sorted and cannot overlap",
        })
      previousEnd = region.rules.end_tick
      slots += Math.ceil(
        (region.rules.end_tick - region.rules.start_tick) / region.rules.step_ticks,
      )
      if (
        rules.fixed_notes.some(
          (note) =>
            note.tick < region.rules.end_tick &&
            note.tick + note.hold_ticks >= region.rules.start_tick,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["regions", index],
          message: "Fixed notes and their hold tails cannot occupy automatic ranges",
        })
    }
    if (slots > 10_000)
      context.addIssue({
        code: "custom",
        message: "Fixed notes and automatic slots exceed the 10000-event limit",
      })
  })
  .readonly()

export const GenerationRulesSchema = z.discriminatedUnion("schema_version", [
  WeightedCycleRulesSchema,
  HybridRulesSchema,
])

export type CycleRules = z.infer<typeof CycleRulesSchema>
export type WeightedCycleRules = z.infer<typeof WeightedCycleRulesSchema>
export type HybridRules = z.infer<typeof HybridRulesSchema>
export type AutomaticRegion = z.infer<typeof AutomaticRegionSchema>
export type AutomaticRegionView = z.infer<typeof AutomaticRegionViewSchema>
export type HybridRegionId = z.infer<typeof HybridRegionIdSchema>
export type GenerationRules = z.infer<typeof GenerationRulesSchema>

export function automaticRegionViews(rules: GenerationRules): readonly AutomaticRegionView[] {
  return rules.schema_version === 1
    ? []
    : rules.regions.map((region) => ({
        id: region.id,
        name: region.name,
        start_tick: region.rules.start_tick,
        end_tick: region.rules.end_tick,
      }))
}
