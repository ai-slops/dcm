import { z } from "zod"

export const STUDIO_MAX_DURATION_TICKS = 1_000_000
export const STUDIO_MAX_NOTES = 10_000
export const STUDIO_MAX_TEMPO_SEGMENTS = 4_096

const JsonSafeIntegerSchema = z.number().int().safe()
export const NonNegativeIntegerSchema = JsonSafeIntegerSchema.nonnegative()
export const PositiveIntegerSchema = JsonSafeIntegerSchema.positive()

export const FractionSchema = z
  .strictObject({
    numerator: NonNegativeIntegerSchema,
    denominator: PositiveIntegerSchema,
  })
  .superRefine((fraction, context) => {
    if (greatestCommonDivisor(fraction.numerator, fraction.denominator) !== 1) {
      context.addIssue({ code: "custom", message: "fraction must be reduced" })
    }
  })
  .readonly()

export const TempoSegmentSchema = z
  .strictObject({
    start_tick: NonNegativeIntegerSchema.max(STUDIO_MAX_DURATION_TICKS - 1),
    micros_per_beat: FractionSchema.refine((fraction) => fraction.numerator > 0, {
      message: "tempo must be positive",
    }),
  })
  .readonly()

export const NativeMusicSchema = z
  .strictObject({
    duration_ticks: PositiveIntegerSchema.max(STUDIO_MAX_DURATION_TICKS),
    ticks_per_beat: PositiveIntegerSchema.max(4_096),
    offset_micros: JsonSafeIntegerSchema,
    tempo: z.array(TempoSegmentSchema).min(1).max(STUDIO_MAX_TEMPO_SEGMENTS).readonly(),
    audio_sha256: z.array(NonNegativeIntegerSchema.max(255)).length(32).readonly(),
    reference_accents: z
      .array(NonNegativeIntegerSchema.max(STUDIO_MAX_DURATION_TICKS - 1))
      .max(STUDIO_MAX_NOTES)
      .readonly(),
  })
  .superRefine((music, context) => {
    if (music.tempo[0]?.start_tick !== 0) {
      context.addIssue({ code: "custom", path: ["tempo"], message: "tempo must start at tick 0" })
    }
    checkStrictTicks(
      music.tempo.map((segment) => segment.start_tick),
      music.duration_ticks,
      ["tempo"],
      context,
    )
    checkStrictTicks(music.reference_accents, music.duration_ticks, ["reference_accents"], context)
  })
  .readonly()

export const NativeNoteSchema = z
  .strictObject({
    tick: NonNegativeIntegerSchema.max(STUDIO_MAX_DURATION_TICKS),
    panel_mask: PositiveIntegerSchema.max(0x03ff),
    hold_ticks: NonNegativeIntegerSchema.max(STUDIO_MAX_DURATION_TICKS),
  })
  .readonly()

const NativeChartShapeSchema = z
  .strictObject({
    ticks_per_beat: PositiveIntegerSchema.max(4_096),
    span_ticks: PositiveIntegerSchema.max(STUDIO_MAX_DURATION_TICKS),
    notes: z.array(NativeNoteSchema).max(STUDIO_MAX_NOTES).readonly(),
  })
  .readonly()

export const NativeChartSchema = NativeChartShapeSchema.superRefine((chart, context) => {
  const activeUntil = Array.from({ length: 10 }, () => 0)
  let previousKey = ""
  for (const [index, note] of chart.notes.entries()) {
    const key = noteKey(note)
    if (previousKey && previousKey >= key) {
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "notes are not canonical",
      })
    }
    previousKey = key
    const end = note.tick + note.hold_ticks
    if ((note.hold_ticks === 0 && note.tick >= chart.span_ticks) || end > chart.span_ticks) {
      context.addIssue({
        code: "custom",
        path: ["notes", index],
        message: "note exceeds chart span",
      })
    }
    for (let panel = 0; panel < 10; panel += 1) {
      if ((note.panel_mask & (1 << panel)) === 0) continue
      if ((activeUntil[panel] ?? 0) > note.tick) {
        context.addIssue({
          code: "custom",
          path: ["notes", index],
          message: "panel demands overlap",
        })
      }
      activeUntil[panel] = note.hold_ticks === 0 ? note.tick + 1 : end
    }
  }
})

export type Fraction = z.infer<typeof FractionSchema>
export type NativeMusic = z.infer<typeof NativeMusicSchema>
export type NativeNote = z.infer<typeof NativeNoteSchema>
export type NativeChart = z.infer<typeof NativeChartSchema>

export function canonicalizeChart(input: unknown): NativeChart {
  const chart = NativeChartShapeSchema.parse(input)
  const notes = [...chart.notes].sort(compareNotes)
  const merged: NativeNote[] = []
  for (const note of notes) {
    const previous = merged.at(-1)
    if (previous?.tick === note.tick && previous.hold_ticks === note.hold_ticks) {
      merged[merged.length - 1] = { ...previous, panel_mask: previous.panel_mask | note.panel_mask }
    } else {
      merged.push(note)
    }
  }
  return NativeChartSchema.parse({ ...chart, notes: merged })
}

function compareNotes(left: NativeNote, right: NativeNote): number {
  return (
    left.tick - right.tick ||
    left.hold_ticks - right.hold_ticks ||
    left.panel_mask - right.panel_mask
  )
}

function noteKey(note: NativeNote): string {
  return [note.tick, note.hold_ticks, note.panel_mask]
    .map((value) => value.toString().padStart(16, "0"))
    .join(":")
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend
}

function checkStrictTicks(
  ticks: readonly number[],
  duration: number,
  path: readonly (string | number)[],
  context: z.RefinementCtx,
): void {
  for (const [index, tick] of ticks.entries()) {
    if (tick >= duration || (index > 0 && tick <= (ticks[index - 1] ?? -1))) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "ticks must be ordered and in range",
      })
    }
  }
}
