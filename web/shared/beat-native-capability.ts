import type { Beat } from "./beat.ts"
import { compareBeats } from "./beat.ts"
import type { BeatEvaluationContract } from "./beat-evaluation.ts"

const NATIVE_TPB_LIMIT = 4_096n

export type NativeGridUnsupported = {
  readonly code: "native_grid_unsupported"
  readonly required_tpb: string
  readonly limit: 4_096
}

export type NativeDurationUnresolved = { readonly code: "native_duration_unresolved" }

export type NativeLimitUnsupported = {
  readonly code: "native_limit_unsupported"
  readonly field: "duration_ticks"
  readonly value: number
  readonly limit: 1_000_000
}

export type NativeEvaluationExtentUnsupported = {
  readonly code: "native_evaluation_extent_unsupported"
  readonly field: string
  readonly required_end: Beat
  readonly duration: Beat
  readonly message: string
}

export type NativeCapability =
  | NativeGridUnsupported
  | NativeDurationUnresolved
  | NativeLimitUnsupported
  | NativeEvaluationExtentUnsupported

export type NativeTicksPerBeatResult =
  | { readonly kind: "supported"; readonly ticks_per_beat: bigint }
  | { readonly kind: "unsupported"; readonly capability: NativeGridUnsupported }

export function nativeTicksPerBeatFor(
  beats: readonly Beat[],
  rowsPerMeasure: readonly number[],
): NativeTicksPerBeatResult {
  let required = 1n
  for (const rows of rowsPerMeasure) {
    required = leastCommonMultiple(required, BigInt(rows) / greatestCommonDivisor(BigInt(rows), 4n))
    if (required > NATIVE_TPB_LIMIT) return gridUnsupported(required)
  }
  for (const beat of beats) {
    required = leastCommonMultiple(required, BigInt(beat.denominator))
    if (required > NATIVE_TPB_LIMIT) return gridUnsupported(required)
  }
  return { kind: "supported", ticks_per_beat: required }
}

export function nativeEvaluationExtentCapability(
  contract: BeatEvaluationContract,
  duration: Beat,
): NativeEvaluationExtentUnsupported | null {
  for (const [index, window] of contract.difficulty.local_windows.entries()) {
    if (compareBeats(window.width, duration) > 0)
      return evaluationUnsupported(
        `difficulty.local_windows[${index}].width`,
        window.width,
        duration,
      )
  }
  for (const [index, intent] of contract.intents.entries()) {
    switch (intent.kind.kind) {
      case "reference_accents":
        if (compareBeats(intent.kind.tolerance, duration) > 0)
          return evaluationUnsupported(
            `intents[${index}].reference_accents.tolerance`,
            intent.kind.tolerance,
            duration,
          )
        break
      case "negative_space":
        if (compareBeats(intent.kind.end, duration) > 0)
          return evaluationUnsupported(
            `intents[${index}].negative_space.end`,
            intent.kind.end,
            duration,
          )
        break
      case "relational_motif":
        break
    }
  }
  return null
}

function gridUnsupported(required: bigint): NativeTicksPerBeatResult {
  return {
    kind: "unsupported",
    capability: {
      code: "native_grid_unsupported",
      required_tpb: required.toString(),
      limit: 4_096,
    },
  }
}

function evaluationUnsupported(
  field: string,
  requiredEnd: Beat,
  duration: Beat,
): NativeEvaluationExtentUnsupported {
  return {
    code: "native_evaluation_extent_unsupported",
    field,
    required_end: requiredEnd,
    duration,
    message: `${field} exceeds the native output duration; set an explicit duration or change the evaluation contract`,
  }
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
  return (left / greatestCommonDivisor(left, right)) * right
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let dividend = left
  let divisor = right
  while (divisor !== 0n) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
