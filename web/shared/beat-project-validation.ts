import type { z } from "zod"

import {
  addBeats,
  type Beat,
  BeatChartCoreSchema,
  type BeatNote,
  type BeatTiming,
  compareBeats,
  isGridAligned,
} from "./beat.ts"
import type { BeatEvaluationContract } from "./beat-evaluation.ts"
import type { BeatGenerationRules } from "./beat-rules.ts"

type BeatProjectValidationInput = {
  readonly mode: "Single" | "Double"
  readonly timing: BeatTiming
  readonly evaluation_contract: BeatEvaluationContract
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
    if (!isIntervalAligned(note.at, addBeats(note.at, note.hold), chart.timing))
      context.addIssue({ code: "custom", path: ["notes", index], message: "note is off grid" })
    if (chart.mode === "Single" && (note.panel_mask & ~0x001f) !== 0)
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "note exceeds Single lanes",
      })
    if (
      chart.timing.duration !== null &&
      compareBeats(addBeats(note.at, note.hold), chart.timing.duration) > 0
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
  for (const [index, cycle] of cycles.entries()) {
    if (project.timing.duration !== null && compareBeats(cycle.end, project.timing.duration) > 0)
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "regions", index],
        message: "generation exceeds duration",
      })
    if (!isIntervalAligned(cycle.start, cycle.end, project.timing))
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "regions", index],
        message: "generation range crosses an off-grid section boundary",
      })
    let slot = cycle.start
    for (
      let slotIndex = 0;
      slotIndex < 10_000 && compareBeats(slot, cycle.end) < 0;
      slotIndex += 1
    ) {
      if (!isPointAligned(slot, project.timing))
        context.addIssue({
          code: "custom",
          path: ["generation_rules", "regions", index],
          message: "generation slot is off grid",
        })
      const frame = cycle.pattern[slotIndex % cycle.pattern.length]
      if (frame !== undefined)
        for (const choice of frame.choices)
          if (!isIntervalAligned(slot, addBeats(slot, choice.hold), project.timing))
            context.addIssue({
              code: "custom",
              path: ["generation_rules", "regions", index],
              message: "generated hold crosses an off-grid section boundary",
            })
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
  validateEvaluationDuration(project.timing.duration, project.evaluation_contract, context)
}

export function validateEvaluationDuration(
  duration: Beat | null,
  contract: BeatEvaluationContract,
  context: z.RefinementCtx,
): void {
  if (duration === null) return
  for (const [index, window] of contract.difficulty.local_windows.entries())
    if (compareBeats(window.width, duration) > 0)
      context.addIssue({
        code: "custom",
        path: ["evaluation_contract", "difficulty", "local_windows", index],
        message: "window exceeds duration",
      })
  for (const [index, intent] of contract.intents.entries())
    if (intent.kind.kind === "negative_space" && compareBeats(intent.kind.end, duration) > 0)
      context.addIssue({
        code: "custom",
        path: ["evaluation_contract", "intents", index],
        message: "intent exceeds duration",
      })
}

function isPointAligned(beat: Beat, timing: BeatTiming): boolean {
  let activeSection = timing.grid_sections[0]
  for (const candidate of timing.grid_sections) {
    if (compareBeats(candidate.at, beat) > 0) break
    activeSection = candidate
  }
  return (
    activeSection !== undefined &&
    isGridAligned(subtractBeat(beat, activeSection.at), activeSection.rows_per_measure)
  )
}

function isIntervalAligned(start: Beat, end: Beat, timing: BeatTiming): boolean {
  if (!isPointAligned(start, timing) || !isPointAligned(end, timing)) return false
  for (let index = 1; index < timing.grid_sections.length; index += 1) {
    const boundary = timing.grid_sections[index]
    const previous = timing.grid_sections[index - 1]
    if (
      boundary !== undefined &&
      previous !== undefined &&
      compareBeats(boundary.at, start) > 0 &&
      compareBeats(boundary.at, end) < 0 &&
      !isGridAligned(subtractBeat(boundary.at, previous.at), previous.rows_per_measure)
    )
      return false
  }
  return true
}

function subtractBeat(left: Beat, right: Beat): Beat {
  const numerator = left.numerator * right.denominator - right.numerator * left.denominator
  const denominator = left.denominator * right.denominator
  const divisor = greatestCommonDivisor(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
