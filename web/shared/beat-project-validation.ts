import type { z } from "zod"

import {
  addBeats,
  BeatChartCoreSchema,
  type BeatNote,
  type BeatTiming,
  compareBeats,
  MAX_BEAT_NOTES,
} from "./beat.ts"
import { type BeatGenerationRules, beatCycleSlotCount } from "./beat-rules.ts"

type BeatProjectValidationInput = {
  readonly mode: "Single" | "Double"
  readonly timing: BeatTiming
  readonly generation_rules: BeatGenerationRules
}

export function validateBeatNotes(
  chart: {
    readonly mode: "Single" | "Double"
    readonly timing: BeatTiming
    readonly notes: readonly BeatNote[]
  },
  context: z.RefinementCtx,
): void {
  for (const [index, note] of chart.notes.entries()) {
    if (chart.mode === "Single" && (note.panel_mask & ~0x001f) !== 0)
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "note exceeds Single lanes",
      })
    if (
      chart.timing.duration !== null &&
      compareBeats(addBeats(note.at, note.hold), chart.timing.duration) >= 0
    )
      context.addIssue({ code: "custom", path: ["notes", index], message: "note exceeds duration" })
  }
  const canonical = BeatChartCoreSchema.safeParse({
    mode: chart.mode,
    timing: chart.timing,
    notes: chart.notes,
  })
  if (!canonical.success)
    context.addIssue({
      code: "custom",
      path: ["notes"],
      message: "notes collide or are not canonical",
    })
}

export function validateBeatGenerationProject(
  project: BeatProjectValidationInput,
  context: z.RefinementCtx,
): void {
  const rules = project.generation_rules
  const cycles = rules.schema_version === 1 ? [rules] : rules.regions.map((region) => region.rules)
  const slotCounts = cycles.map((cycle) => beatCycleSlotCount(cycle))
  const totalDemand = slotCounts.reduce(
    (total, count) => total + count,
    BigInt(rules.schema_version === 2 ? rules.fixed_notes.length : 0),
  )
  if (
    slotCounts.some((count) => count > BigInt(MAX_BEAT_NOTES)) ||
    totalDemand > BigInt(MAX_BEAT_NOTES)
  ) {
    context.addIssue({
      code: "custom",
      path: ["generation_rules"],
      message: "fixed notes and generated slots exceed 10000",
    })
    return
  }
  for (const [index, cycle] of cycles.entries()) {
    if (project.timing.duration !== null && compareBeats(cycle.end, project.timing.duration) > 0)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "regions", index],
        message: "generation exceeds duration",
      })
    let slot = cycle.start
    const slotCount = Number(slotCounts[index] ?? 0n)
    let holdExtentReported = false
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const frame = cycle.pattern[slotIndex % cycle.pattern.length]
      if (frame !== undefined)
        for (const choice of frame.choices) {
          const holdTail = addBeats(slot, choice.hold)
          if (
            rules.schema_version === 2 &&
            compareBeats(holdTail, cycle.end) >= 0 &&
            !holdExtentReported
          ) {
            context.addIssue({
              code: "custom",
              path: ["generation_rules", "regions", index],
              message: "generated hold tail must stay before the automatic region end",
            })
            holdExtentReported = true
          }
        }
      slot = addBeats(slot, cycle.step)
    }
    for (const frame of cycle.pattern)
      for (const choice of frame.choices)
        if (project.mode === "Single" && (choice.panel_mask & ~0x001f) !== 0)
          context.addIssue({
            code: "custom",
            path: ["generation_rules"],
            message: "rule exceeds Single lanes",
          })
  }
  if (rules.schema_version === 2) {
    validateBeatNotes(
      { mode: project.mode, timing: project.timing, notes: rules.fixed_notes },
      context,
    )
    const fixed = BeatChartCoreSchema.safeParse({
      timing: project.timing,
      notes: rules.fixed_notes,
      mode: project.mode,
    })
    if (!fixed.success)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "fixed_notes"],
        message: "fixed notes collide or are not canonical",
      })
  }
}
