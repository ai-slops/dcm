import type { Beat, BeatTiming } from "../../shared/beat.ts"
import { compareBeats } from "../../shared/beat.ts"
import { audioMicrosToBeatPosition, beatToAudioMicros } from "./beat-timing.ts"

export const MAX_SELECTED_BEAT_SPLIT = 128

const defaultMaximumGridPoints = 2_048

export type BeatTimelinePoint = {
  readonly beat: Beat
  readonly audioMicros: number
  readonly kind: "grid" | "exact"
}

export type BeatTimelinePointsInput = {
  readonly timing: BeatTiming
  readonly selectedSplit: number
  readonly range: { readonly startMicros: number; readonly endMicros: number }
  readonly exactBeats: readonly Beat[]
  readonly maximumGridPoints?: number
}

export function snapBeatToSelectedSplit(target: Beat, selectedSplit: number): Beat {
  assertSelectedSplit(selectedSplit)
  const ordinal = (BigInt(target.numerator) * BigInt(selectedSplit)) / BigInt(target.denominator)
  return reducedBeat(ordinal, BigInt(selectedSplit))
}

export function beatTimelinePointsInAudioRange(
  input: BeatTimelinePointsInput,
): readonly BeatTimelinePoint[] {
  assertSelectedSplit(input.selectedSplit)
  if (input.range.endMicros < input.range.startMicros)
    throw new RangeError("Timeline audio range must be ordered")
  const maximumGridPoints = input.maximumGridPoints ?? defaultMaximumGridPoints
  if (!Number.isSafeInteger(maximumGridPoints) || maximumGridPoints < 1)
    throw new RangeError("Timeline grid point limit must be positive")
  const points = new Map<string, BeatTimelinePoint>()
  const startPosition = audioMicrosToBeatPosition(input.timing, input.range.startMicros) ?? 0
  const endPosition = audioMicrosToBeatPosition(input.timing, input.range.endMicros)
  if (endPosition !== null) {
    const firstOrdinal = Math.max(0, Math.ceil(startPosition * input.selectedSplit))
    const lastOrdinal = Math.max(firstOrdinal - 1, Math.floor(endPosition * input.selectedSplit))
    const count = lastOrdinal - firstOrdinal + 1
    const stride = Math.max(1, Math.ceil(count / maximumGridPoints))
    for (let ordinal = firstOrdinal; ordinal <= lastOrdinal; ordinal += stride) {
      const beat = reducedBeat(BigInt(ordinal), BigInt(input.selectedSplit))
      points.set(beatKey(beat), {
        beat,
        audioMicros: beatToAudioMicros(input.timing, beat),
        kind: "grid",
      })
    }
  }
  for (const beat of input.exactBeats) {
    const audioMicros = beatToAudioMicros(input.timing, beat)
    if (audioMicros < input.range.startMicros || audioMicros > input.range.endMicros) continue
    points.set(beatKey(beat), { beat, audioMicros, kind: "exact" })
  }
  return [...points.values()].sort(
    (left, right) => left.audioMicros - right.audioMicros || compareBeats(left.beat, right.beat),
  )
}

function beatKey(value: Beat): string {
  return `${value.numerator}/${value.denominator}`
}

function reducedBeat(numerator: bigint, denominator: bigint): Beat {
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    numerator: safeNumber(numerator / divisor),
    denominator: safeNumber(denominator / divisor),
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let dividend = left
  let divisor = right
  while (divisor !== 0n) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend === 0n ? 1n : dividend
}

function safeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new RangeError("Beat arithmetic exceeds safe integers")
  return result
}

function assertSelectedSplit(selectedSplit: number): void {
  if (
    !Number.isSafeInteger(selectedSplit) ||
    selectedSplit < 1 ||
    selectedSplit > MAX_SELECTED_BEAT_SPLIT
  )
    throw new RangeError(`Selected split must be between 1 and ${MAX_SELECTED_BEAT_SPLIT}`)
}
