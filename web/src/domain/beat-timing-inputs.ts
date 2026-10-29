import type { Beat, BeatChartDocument, Fraction } from "../../shared/index.ts"
import { addBeats, BeatChartDocumentSchema, BeatSchema, compareBeats } from "../../shared/index.ts"
import { bpmToMicrosPerBeat } from "./timing-inputs.ts"

export type BeatDocumentEditResult =
  | { readonly kind: "success"; readonly project: BeatChartDocument }
  | { readonly kind: "error"; readonly message: string }

export type BeatParseResult =
  | { readonly kind: "success"; readonly beat: Beat }
  | { readonly kind: "error"; readonly message: string }

export function parseBeatInput(input: string): BeatParseResult {
  const match = /^\s*(\d+)(?:\s*\/\s*(\d+))?\s*$/.exec(input)
  if (match === null)
    return { kind: "error", message: "Enter a beat as a whole number or reduced fraction." }
  const numerator = Number(match[1])
  const denominator = Number(match[2] ?? "1")
  const parsed = BeatSchema.safeParse({ numerator, denominator })
  return parsed.success
    ? { kind: "success", beat: parsed.data }
    : { kind: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid beat." }
}

export function setBeatDuration(project: BeatChartDocument, input: string): BeatDocumentEditResult {
  if (input.trim() === "")
    return validatedDocument({ ...project, timing: { ...project.timing, duration: null } })
  const parsed = parseBeatInput(input)
  if (parsed.kind === "error") return parsed
  const conflict = project.notes.find((note) => {
    const end = addBeats(note.at, note.hold)
    return compareBeats(end, parsed.beat) >= 0
  })
  if (conflict !== undefined)
    return { kind: "error", message: "The explicit duration would truncate a note or hold." }
  return validatedDocument({ ...project, timing: { ...project.timing, duration: parsed.beat } })
}

export function updateTempoMarker(
  project: BeatChartDocument,
  index: number,
  atInput: string,
  bpmInput: string,
): BeatDocumentEditResult {
  const at = parseBeatInput(atInput)
  if (at.kind === "error") return at
  if (index === 0 && at.beat.numerator !== 0)
    return { kind: "error", message: "The base tempo marker must stay at beat zero." }
  const bpm = bpmToMicrosPerBeat(bpmInput)
  if (bpm.kind === "error") return bpm
  const tempo = project.timing.tempo
    .map((segment, current) =>
      current === index ? { at: at.beat, micros_per_beat: bpm.fraction } : segment,
    )
    .sort((left, right) => compareBeats(left.at, right.at))
  return validatedDocument({ ...project, timing: { ...project.timing, tempo } })
}

export function addTempoMarker(
  project: BeatChartDocument,
  atInput: string,
  bpmInput: string,
): BeatDocumentEditResult {
  const at = parseBeatInput(atInput)
  if (at.kind === "error") return at
  const bpm = bpmToMicrosPerBeat(bpmInput)
  if (bpm.kind === "error") return bpm
  return validatedDocument({
    ...project,
    timing: {
      ...project.timing,
      tempo: [...project.timing.tempo, { at: at.beat, micros_per_beat: bpm.fraction }].sort(
        (left, right) => compareBeats(left.at, right.at),
      ),
    },
  })
}

export function removeTempoMarker(
  project: BeatChartDocument,
  index: number,
): BeatDocumentEditResult {
  if (index === 0) return { kind: "error", message: "The base tempo marker cannot be removed." }
  return validatedDocument({
    ...project,
    timing: {
      ...project.timing,
      tempo: project.timing.tempo.filter((_, current) => current !== index),
    },
  })
}

export function bpmInputValue(fraction: Fraction): string {
  const numerator = 60_000_000n * BigInt(fraction.denominator)
  const denominator = BigInt(fraction.numerator)
  const whole = numerator / denominator
  let remainder = numerator % denominator
  let decimals = ""
  while (remainder !== 0n && decimals.length < 6) {
    remainder *= 10n
    decimals += String(remainder / denominator)
    remainder %= denominator
  }
  return decimals === "" ? String(whole) : `${whole}.${decimals}`
}

function validatedDocument(project: BeatChartDocument): BeatDocumentEditResult {
  const parsed = BeatChartDocumentSchema.safeParse(project)
  return parsed.success
    ? { kind: "success", project: parsed.data }
    : { kind: "error", message: parsed.error.issues[0]?.message ?? "The timing map is invalid." }
}
