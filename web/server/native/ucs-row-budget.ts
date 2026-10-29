import { type Beat, type BeatTiming, compareBeats } from "../../shared/beat.ts"
import { StudioError } from "../errors.ts"

export function assertUcsRowBudget(timing: BeatTiming, duration: Beat): void {
  const boundaries = [
    ...new Map(
      [
        ...timing.tempo.map((segment) => segment.at),
        ...timing.grid_sections.map((section) => section.at),
        duration,
      ].map((at) => [`${at.numerator}/${at.denominator}`, at]),
    ).values(),
  ].sort(compareBeats)
  let gridIndex = 0
  let total = 0n
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1]
    const end = boundaries[index]
    if (start === undefined || end === undefined) continue
    while (gridIndex + 1 < timing.grid_sections.length) {
      const next = timing.grid_sections[gridIndex + 1]
      if (next === undefined || compareBeats(next.at, start) > 0) break
      gridIndex += 1
    }
    const section = timing.grid_sections[gridIndex]
    if (section === undefined)
      throw new StudioError(422, "ucs_grid_missing", "UCS requires an initial grid")
    const rows = BigInt(section.rows_per_measure)
    const split = rows / gcd(rows, 4n)
    const numerator =
      (BigInt(end.numerator) * BigInt(start.denominator) -
        BigInt(start.numerator) * BigInt(end.denominator)) *
      split
    const denominator = BigInt(end.denominator) * BigInt(start.denominator)
    total += (numerator + denominator - 1n) / denominator
    if (total > 1_000_000n)
      throw new StudioError(422, "ucs_row_limit", "UCS output exceeds the 1000000-row limit")
  }
}

function gcd(left: bigint, right: bigint): bigint {
  let dividend = left
  let divisor = right
  while (divisor !== 0n) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
