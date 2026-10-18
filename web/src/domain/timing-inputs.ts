import { z } from "zod"

import {
  type Fraction,
  FractionSchema,
  type NativeMusic,
  NativeMusicSchema,
  STUDIO_MAX_DURATION_TICKS,
  type StudioProjectV1,
  StudioProjectV1Schema,
} from "../../shared/index.ts"

type FractionResult =
  | { readonly kind: "success"; readonly fraction: Fraction }
  | { readonly kind: "error"; readonly message: string }

export type TimingEditResult =
  | { readonly kind: "success"; readonly project: StudioProjectV1 }
  | { readonly kind: "error"; readonly message: string }

type TempoEditInput = {
  readonly originalTick: number
  readonly tick: string
  readonly bpm: string
}

const BpmInputSchema = z
  .string()
  .regex(/^\d{1,4}(?:\.\d{1,6})?$/, "Enter a positive BPM with up to 6 decimal places")

const TickInputSchema = z
  .string()
  .regex(/^\d+$/, "Enter a whole-number tick")
  .transform((value) => Number(value))
  .pipe(z.number().int().safe().nonnegative().max(STUDIO_MAX_DURATION_TICKS))

function gcd(left: bigint, right: bigint): bigint {
  let dividend = left
  let divisor = right
  while (divisor !== 0n) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend
}

function expectedError(message: string): TimingEditResult {
  return { kind: "error", message }
}

function parseTick(input: string): number | string {
  const parsed = TickInputSchema.safeParse(input)
  return parsed.success ? parsed.data : (parsed.error.issues[0]?.message ?? "Enter a valid tick")
}

function validatedProject(project: StudioProjectV1, music: NativeMusic): TimingEditResult {
  const parsedMusic = NativeMusicSchema.safeParse(music)
  if (!parsedMusic.success) {
    return expectedError(parsedMusic.error.issues[0]?.message ?? "The timing map is invalid")
  }
  const parsedProject = StudioProjectV1Schema.safeParse({ ...project, music: parsedMusic.data })
  return parsedProject.success
    ? { kind: "success", project: parsedProject.data }
    : expectedError(parsedProject.error.issues[0]?.message ?? "The project timing is invalid")
}

export function bpmToMicrosPerBeat(input: string): FractionResult {
  const parsed = BpmInputSchema.safeParse(input)
  if (!parsed.success) {
    return { kind: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid BPM" }
  }
  const [whole = "", decimals = ""] = parsed.data.split(".")
  const scale = 10n ** BigInt(decimals.length)
  const bpmNumerator = BigInt(whole) * scale + BigInt(decimals === "" ? "0" : decimals)
  if (bpmNumerator === 0n || bpmNumerator > 1_000n * scale) {
    return { kind: "error", message: "BPM must be greater than 0 and no more than 1000" }
  }
  const numerator = 60_000_000n * scale
  const divisor = gcd(numerator, bpmNumerator)
  const reducedNumerator = numerator / divisor
  const reducedDenominator = bpmNumerator / divisor
  if (
    reducedNumerator > BigInt(Number.MAX_SAFE_INTEGER) ||
    reducedDenominator > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return { kind: "error", message: "BPM cannot be represented safely" }
  }
  const fraction = FractionSchema.parse({
    numerator: Number(reducedNumerator),
    denominator: Number(reducedDenominator),
  })
  return { kind: "success", fraction }
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

export function addTempoChange(
  project: StudioProjectV1,
  tickInput: string,
  bpmInput: string,
): TimingEditResult {
  const tick = parseTick(tickInput)
  if (typeof tick === "string") return expectedError(tick)
  if (tick >= project.music.duration_ticks)
    return expectedError("Tempo tick must be within the chart")
  if (project.music.tempo.some((segment) => segment.start_tick === tick)) {
    return expectedError(`A tempo change already starts at tick ${tick}`)
  }
  const bpm = bpmToMicrosPerBeat(bpmInput)
  if (bpm.kind === "error") return bpm
  const tempo = [...project.music.tempo, { start_tick: tick, micros_per_beat: bpm.fraction }].sort(
    (left, right) => left.start_tick - right.start_tick,
  )
  return validatedProject(project, { ...project.music, tempo })
}

export function editTempoChange(project: StudioProjectV1, input: TempoEditInput): TimingEditResult {
  const tick = parseTick(input.tick)
  if (typeof tick === "string") return expectedError(tick)
  if (input.originalTick === 0 && tick !== 0)
    return expectedError("The tempo marker at tick 0 cannot move")
  if (tick >= project.music.duration_ticks)
    return expectedError("Tempo tick must be within the chart")
  if (!project.music.tempo.some((segment) => segment.start_tick === input.originalTick)) {
    return expectedError("The tempo marker no longer exists")
  }
  if (
    tick !== input.originalTick &&
    project.music.tempo.some((segment) => segment.start_tick === tick)
  ) {
    return expectedError(`A tempo change already starts at tick ${tick}`)
  }
  const bpm = bpmToMicrosPerBeat(input.bpm)
  if (bpm.kind === "error") return bpm
  const tempo = project.music.tempo
    .map((segment) =>
      segment.start_tick === input.originalTick
        ? { start_tick: tick, micros_per_beat: bpm.fraction }
        : segment,
    )
    .sort((left, right) => left.start_tick - right.start_tick)
  return validatedProject(project, { ...project.music, tempo })
}

export function removeTempoChange(project: StudioProjectV1, startTick: number): TimingEditResult {
  if (startTick === 0) return expectedError("The tempo marker at tick 0 cannot be removed")
  if (!project.music.tempo.some((segment) => segment.start_tick === startTick)) {
    return expectedError("The tempo marker no longer exists")
  }
  const tempo = project.music.tempo.filter((segment) => segment.start_tick !== startTick)
  return validatedProject(project, { ...project.music, tempo })
}

function shorteningError(project: StudioProjectV1, duration: number): string | undefined {
  const note = project.chart.notes.find((item) =>
    item.hold_ticks === 0 ? item.tick >= duration : item.tick + item.hold_ticks > duration,
  )
  if (note !== undefined) return `A note or hold tail reaches tick ${note.tick + note.hold_ticks}`
  const tempo = project.music.tempo.find((segment) => segment.start_tick >= duration)
  if (tempo !== undefined) return `A tempo change starts at tick ${tempo.start_tick}`
  const accent = project.music.reference_accents.find((tick) => tick >= duration)
  if (accent !== undefined) return `A reference accent exists at tick ${accent}`
  const window = project.evaluation_contract.difficulty.local_windows.find(
    (item) => item.width_ticks > duration,
  )
  if (window !== undefined) return `A difficulty window spans ${window.width_ticks} ticks`
  const intent = project.evaluation_contract.intents.find((item) => {
    switch (item.kind.kind) {
      case "reference_accents":
        return item.kind.tolerance_ticks > duration
      case "negative_space":
        return item.kind.end_tick > duration
      case "relational_motif":
        return false
    }
    return false
  })
  return intent === undefined ? undefined : `Intent ${intent.id} extends beyond tick ${duration}`
}

export function setChartDuration(project: StudioProjectV1, input: string): TimingEditResult {
  const duration = parseTick(input)
  if (typeof duration === "string") return expectedError(duration)
  if (duration === 0) return expectedError("Chart duration must be greater than 0")
  const conflict = shorteningError(project, duration)
  if (conflict !== undefined) return expectedError(`Cannot shorten the chart. ${conflict}.`)
  const parsed = StudioProjectV1Schema.safeParse({
    ...project,
    music: { ...project.music, duration_ticks: duration },
    chart: { ...project.chart, span_ticks: duration },
  })
  return parsed.success
    ? { kind: "success", project: parsed.data }
    : expectedError(parsed.error.issues[0]?.message ?? "The chart duration is invalid")
}
