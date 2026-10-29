import { z } from "zod"

import { FractionSchema, NonNegativeIntegerSchema, PositiveIntegerSchema } from "./native.ts"
import { UcsModeSchema } from "./project.ts"

export const MAX_BEAT_NOTES = 10_000
export const MAX_BEAT_TIMING_SECTIONS = 4_096
export const MAX_ROWS_PER_MEASURE = 512

export const BeatSchema = z
  .strictObject({ numerator: NonNegativeIntegerSchema, denominator: PositiveIntegerSchema })
  .superRefine((beat, context) => {
    if (greatestCommonDivisor(beat.numerator, beat.denominator) !== 1)
      context.addIssue({ code: "custom", message: "beat must be reduced" })
  })
  .readonly()

export const PositiveBeatSchema = BeatSchema.refine((beat) => beat.numerator > 0, {
  message: "beat must be positive",
})

export const BeatNoteSchema = z
  .strictObject({
    at: BeatSchema,
    hold: BeatSchema,
    panel_mask: PositiveIntegerSchema.max(0x03ff),
  })
  .readonly()

export const BeatTimingSchema = z
  .strictObject({
    schema_version: z.literal(1),
    offset_micros: z.number().int().safe(),
    tempo: z
      .array(
        z
          .strictObject({
            at: BeatSchema,
            micros_per_beat: FractionSchema.refine((value) => value.numerator > 0, {
              message: "tempo must be positive",
            }),
          })
          .readonly(),
      )
      .min(1)
      .max(MAX_BEAT_TIMING_SECTIONS)
      .readonly(),
    grid_sections: z
      .array(
        z
          .strictObject({
            at: BeatSchema,
            rows_per_measure: PositiveIntegerSchema.max(MAX_ROWS_PER_MEASURE),
          })
          .readonly(),
      )
      .min(1)
      .max(MAX_BEAT_TIMING_SECTIONS)
      .readonly(),
    duration: PositiveBeatSchema.nullable(),
    reference_accents: z.array(BeatSchema).max(MAX_BEAT_NOTES).readonly(),
  })
  .superRefine((timing, context) => {
    checkOrderedFromZero(
      timing.tempo.map((segment) => segment.at),
      timing.duration,
      ["tempo"],
      context,
    )
    checkOrderedFromZero(
      timing.grid_sections.map((section) => section.at),
      timing.duration,
      ["grid_sections"],
      context,
    )
    for (let index = 1; index < timing.grid_sections.length; index += 1) {
      const section = timing.grid_sections[index]
      const previous = timing.grid_sections[index - 1]
      if (
        section !== undefined &&
        previous !== undefined &&
        !isGridAligned(subtractBeats(section.at, previous.at), previous.rows_per_measure)
      )
        context.addIssue({
          code: "custom",
          path: ["grid_sections", index, "at"],
          message: "grid section boundary is off the preceding section grid",
        })
    }
    checkStrictBeats(timing.reference_accents, timing.duration, ["reference_accents"], context)
  })
  .readonly()

export const BaseUcsRefSchema = z.discriminatedUnion("source", [
  z
    .strictObject({
      source: z.literal("archive_entry"),
      archive_id: z.uuid().brand("ArchiveId"),
      archive_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      entry_name: z.string().min(1).max(512),
    })
    .readonly(),
  z
    .strictObject({
      source: z.literal("saved_chart"),
      chart_id: z.uuid().brand("ChartId"),
    })
    .readonly(),
])

export const BeatChartCoreSchema = z
  .strictObject({
    timing: BeatTimingSchema,
    notes: z.array(BeatNoteSchema).max(MAX_BEAT_NOTES).readonly(),
    mode: UcsModeSchema,
  })
  .superRefine((chart, context) => validateBeatNotes(chart, context))
  .readonly()

export type Beat = z.infer<typeof BeatSchema>
export type BeatNote = z.infer<typeof BeatNoteSchema>
export type BeatTiming = z.infer<typeof BeatTimingSchema>
export type BaseUcsRef = z.infer<typeof BaseUcsRefSchema>
export type BeatChartCore = z.infer<typeof BeatChartCoreSchema>

export function beatFromTicks(tick: number, ticksPerBeat: number): Beat {
  NonNegativeIntegerSchema.parse(tick)
  PositiveIntegerSchema.parse(ticksPerBeat)
  const divisor = greatestCommonDivisor(tick, ticksPerBeat)
  return BeatSchema.parse({ numerator: tick / divisor, denominator: ticksPerBeat / divisor })
}

export function compareBeats(left: Beat, right: Beat): number {
  const leftScaled = BigInt(left.numerator) * BigInt(right.denominator)
  const rightScaled = BigInt(right.numerator) * BigInt(left.denominator)
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0
}

export function addBeats(left: Beat, right: Beat): Beat {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator
  const denominator = left.denominator * right.denominator
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    throw new RangeError("Beat arithmetic exceeds JSON-safe integer range")
  const divisor = greatestCommonDivisor(numerator, denominator)
  return BeatSchema.parse({ numerator: numerator / divisor, denominator: denominator / divisor })
}

export function subtractBeats(left: Beat, right: Beat): Beat {
  const numerator = left.numerator * right.denominator - right.numerator * left.denominator
  const denominator = left.denominator * right.denominator
  if (numerator < 0) throw new RangeError("Beat subtraction cannot produce a negative beat")
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    throw new RangeError("Beat arithmetic exceeds JSON-safe integer range")
  const divisor = greatestCommonDivisor(numerator, denominator)
  return BeatSchema.parse({ numerator: numerator / divisor, denominator: denominator / divisor })
}

export function isGridAligned(beat: Beat, rowsPerMeasure: number): boolean {
  return (BigInt(beat.numerator) * BigInt(rowsPerMeasure)) % (4n * BigInt(beat.denominator)) === 0n
}

function validateBeatNotes(
  chart: {
    readonly timing: BeatTiming
    readonly notes: readonly BeatNote[]
    readonly mode: "Single" | "Double"
  },
  context: z.RefinementCtx,
): void {
  const panelEnds: (Beat | null)[] = Array.from({ length: 10 }, () => null)
  let previous: BeatNote | undefined
  for (const [index, note] of chart.notes.entries()) {
    const end = addBeats(note.at, note.hold)
    if (previous !== undefined && compareNotes(previous, note) >= 0)
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "notes are not canonical",
      })
    previous = note
    if (chart.timing.duration !== null) {
      const comparison = compareBeats(end, chart.timing.duration)
      if (comparison > 0 || (note.hold.numerator === 0 && comparison === 0))
        context.addIssue({
          code: "custom",
          path: ["notes", index],
          message: "note exceeds duration",
        })
    }
    if (chart.mode === "Single" && (note.panel_mask & ~0x001f) !== 0)
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "note exceeds Single lanes",
      })
    for (let panel = 0; panel < 10; panel += 1) {
      if ((note.panel_mask & (1 << panel)) === 0) continue
      const activeEnd = panelEnds[panel] ?? null
      if (activeEnd !== null && compareBeats(activeEnd, note.at) >= 0)
        context.addIssue({
          code: "custom",
          path: ["notes", index],
          message: "panel demands overlap",
        })
      panelEnds[panel] = end
    }
  }
}

function compareNotes(left: BeatNote, right: BeatNote): number {
  return (
    compareBeats(left.at, right.at) ||
    compareBeats(left.hold, right.hold) ||
    left.panel_mask - right.panel_mask
  )
}

function checkOrderedFromZero(
  beats: readonly Beat[],
  duration: Beat | null,
  path: readonly string[],
  context: z.RefinementCtx,
): void {
  if (beats[0] !== undefined && beats[0].numerator !== 0)
    context.addIssue({
      code: "custom",
      path: [...path],
      message: "sections must start at beat zero",
    })
  checkStrictBeats(beats, duration, path, context)
}

function checkStrictBeats(
  beats: readonly Beat[],
  duration: Beat | null,
  path: readonly string[],
  context: z.RefinementCtx,
): void {
  for (const [index, beat] of beats.entries())
    if (
      (index > 0 && compareBeats(beats[index - 1] ?? beat, beat) >= 0) ||
      (duration !== null && compareBeats(beat, duration) >= 0)
    )
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "beats must be ordered and in range",
      })
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
