import type { z } from "zod"

import {
  addBeats,
  type Beat,
  BeatChartCoreSchema,
  type BeatNote,
  type BeatTiming,
  compareBeats,
  isGridAligned,
  MAX_BEAT_NOTES,
  subtractBeats,
} from "./beat.ts"
import type { BeatEvaluationContract } from "./beat-evaluation.ts"
import { type BeatGenerationRules, beatCycleSlotCount } from "./beat-rules.ts"

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
    if (!isIntervalAligned(cycle.start, cycle.end, project.timing))
      context.addIssue({
        code: "custom",
        path: ["generation_rules", "regions", index],
        message: "generation range crosses an off-grid section boundary",
      })
    let slot = cycle.start
    const slotCount = Number(slotCounts[index] ?? 0n)
    let slotAlignmentReported = false
    let holdAlignmentReported = false
    let holdExtentReported = false
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      if (!isPointAligned(slot, project.timing))
        if (!slotAlignmentReported) {
          context.addIssue({
            code: "custom",
            path: ["generation_rules", "regions", index],
            message: "generation slot is off grid",
          })
          slotAlignmentReported = true
        }
      const frame = cycle.pattern[slotIndex % cycle.pattern.length]
      if (frame !== undefined)
        for (const choice of frame.choices) {
          const holdTail = addBeats(slot, choice.hold)
          if (!isIntervalAligned(slot, holdTail, project.timing) && !holdAlignmentReported) {
            context.addIssue({
              code: "custom",
              path: ["generation_rules", "regions", index],
              message: "generated hold crosses an off-grid section boundary",
            })
            holdAlignmentReported = true
          }
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
  const activeSection = activeGridSection(beat, timing)
  return (
    activeSection !== undefined &&
    isGridAligned(subtractBeats(beat, activeSection.at), activeSection.rows_per_measure)
  )
}

function isIntervalAligned(start: Beat, end: Beat, timing: BeatTiming): boolean {
  return isPointAligned(start, timing) && isPointAligned(end, timing)
}

function activeGridSection(beat: Beat, timing: BeatTiming) {
  let low = 0
  let high = timing.grid_sections.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const section = timing.grid_sections[middle]
    if (section !== undefined && compareBeats(section.at, beat) <= 0) low = middle + 1
    else high = middle
  }
  return timing.grid_sections[Math.max(0, low - 1)]
}
