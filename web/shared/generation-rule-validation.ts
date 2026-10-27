import type { z } from "zod"

import type { CycleRules, GenerationRules } from "./generation-rules.ts"

type RuleBinding = {
  readonly rules: GenerationRules
  readonly duration: number
  readonly mode: "Single" | "Double"
}

export function validateProjectRules(binding: RuleBinding, context: z.RefinementCtx): void {
  const { rules, duration, mode } = binding
  const cycles = rules.schema_version === 1 ? [rules] : rules.regions.map((region) => region.rules)
  for (const cycle of cycles)
    checkBoundCycle({ cycle, duration, mode, regionBound: rules.schema_version === 2 }, context)
  if (rules.schema_version === 1) return
  for (const [index, note] of rules.fixed_notes.entries()) {
    if (note.tick >= duration || note.tick + note.hold_ticks >= duration)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "fixed_notes", index],
        message: "Fixed notes and hold tails must precede project end",
      })
    if (mode === "Single" && (note.panel_mask & ~0x001f) !== 0)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "fixed_notes", index],
        message: "Single projects allow only five left-pad lanes",
      })
  }
}

function checkBoundCycle(
  input: {
    readonly cycle: CycleRules
    readonly duration: number
    readonly mode: "Single" | "Double"
    readonly regionBound: boolean
  },
  context: z.RefinementCtx,
): void {
  const { cycle, duration, mode } = input
  if (cycle.end_tick > duration)
    context.addIssue({
      code: "custom",
      path: ["generation_rules"],
      message: "Generation range exceeds project timing",
    })
  const slots = Math.ceil((cycle.end_tick - cycle.start_tick) / cycle.step_ticks)
  for (const [index, frame] of cycle.pattern.entries())
    for (const choice of frame.choices) {
      if (mode === "Single" && (choice.panel_mask & ~0x001f) !== 0)
        context.addIssue({
          code: "custom",
          path: ["generation_rules"],
          message: "Single projects allow only five left-pad lanes",
        })
      if (index >= slots || choice.hold_ticks === 0) continue
      const lastSlot =
        index + Math.floor((slots - 1 - index) / cycle.pattern.length) * cycle.pattern.length
      if (
        cycle.start_tick + lastSlot * cycle.step_ticks + choice.hold_ticks >=
        (input.regionBound ? cycle.end_tick : duration)
      )
        context.addIssue({
          code: "custom",
          path: ["generation_rules"],
          message: "Hold tails must precede their automatic range or project end",
        })
    }
}
