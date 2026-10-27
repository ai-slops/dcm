import { z } from "zod"

import { NonNegativeIntegerSchema, PositiveIntegerSchema } from "./native.ts"

export const GenerationRulesSchema = z
  .strictObject({
    schema_version: z.literal(1),
    algorithm: z.literal("weighted_cycle_v1"),
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
  })
  .superRefine((rules, context) => {
    if (rules.end_tick <= rules.start_tick)
      context.addIssue({ code: "custom", message: "Generation range must be nonempty" })
    if (Math.ceil((rules.end_tick - rules.start_tick) / rules.step_ticks) > 10_000)
      context.addIssue({ code: "custom", message: "Generation exceeds the 10000-slot limit" })
  })
  .readonly()

export type GenerationRules = z.infer<typeof GenerationRulesSchema>
