export type ExactBeat = {
  readonly numerator: number
  readonly denominator: number
}

export function compareBeats(left: ExactBeat, right: ExactBeat): number {
  const leftScaled = BigInt(left.numerator) * BigInt(right.denominator)
  const rightScaled = BigInt(right.numerator) * BigInt(left.denominator)
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0
}

export function addBeats(left: ExactBeat, right: ExactBeat): ExactBeat {
  return reducedBeat(
    BigInt(left.numerator) * BigInt(right.denominator) +
      BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator),
  )
}

export function subtractBeats(left: ExactBeat, right: ExactBeat): ExactBeat {
  const numerator =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator)
  if (numerator < 0n) throw new RangeError("Beat subtraction cannot produce a negative beat")
  return reducedBeat(numerator, BigInt(left.denominator) * BigInt(right.denominator))
}

export function isGridAligned(beat: ExactBeat, rowsPerMeasure: number): boolean {
  return (BigInt(beat.numerator) * BigInt(rowsPerMeasure)) % (4n * BigInt(beat.denominator)) === 0n
}

function reducedBeat(numerator: bigint, denominator: bigint): ExactBeat {
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    numerator: safeNumber(numerator / divisor),
    denominator: safeNumber(denominator / divisor),
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let dividend = left < 0n ? -left : left
  let divisor = right
  while (divisor !== 0n) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend === 0n ? 1n : dividend
}

function safeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result))
    throw new RangeError("Beat arithmetic exceeds JSON-safe integer range")
  return result
}
