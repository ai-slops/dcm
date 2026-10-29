import {
  addBeats,
  type Beat,
  type BeatNote,
  type BeatTiming,
  compareBeats,
  MAX_EDIT_ROWS_PER_MEASURE,
  subtractBeats,
} from "../../shared/beat.ts"
import type { PanelIndex } from "./editor.ts"

export type BeatTimelineCellState = "tap" | "hold-head" | "hold-body" | "hold-tail"
export type LaneTone = "blue" | "red" | "yellow"

export type BeatTimelineCell = {
  readonly note: BeatNote
  readonly state: BeatTimelineCellState
}

export type SplitChangeResult =
  | { readonly kind: "success"; readonly timing: BeatTiming }
  | { readonly kind: "error"; readonly message: string }

const four = { numerator: 4, denominator: 1 } as const satisfies Beat
const zero = { numerator: 0, denominator: 1 } as const satisfies Beat

export const beatCompare = compareBeats

export function laneTone(lane: number): LaneTone {
  const position = ((lane % 5) + 5) % 5
  if (position === 2) return "yellow"
  return position === 0 || position === 4 ? "blue" : "red"
}

export const beatAdd = addBeats
export const beatSubtract = subtractBeats

export function beatAtTimelineRow(timing: BeatTiming, row: number): Beat {
  if (!Number.isSafeInteger(row) || row < 0)
    throw new RangeError("Timeline row must be nonnegative")
  let remaining = row
  for (const [index, section] of timing.grid_sections.entries()) {
    const next = timing.grid_sections[index + 1]
    if (next === undefined)
      return beatAdd(section.at, rowsToBeats(remaining, section.rows_per_measure))
    const sectionRows = rowsBeforeBoundary(section.at, next.at, section.rows_per_measure)
    if (remaining < sectionRows)
      return beatAdd(section.at, rowsToBeats(remaining, section.rows_per_measure))
    remaining -= sectionRows
  }
  throw new RangeError("Timeline timing requires at least one grid section")
}

export function timelineRowAtBeat(timing: BeatTiming, target: Beat): number {
  let rows = 0
  for (const [index, section] of timing.grid_sections.entries()) {
    const next = timing.grid_sections[index + 1]
    if (next === undefined || beatCompare(target, next.at) < 0) {
      const local = beatSubtract(target, section.at)
      return rows + floorRows(local, section.rows_per_measure)
    }
    rows += rowsBeforeBoundary(section.at, next.at, section.rows_per_measure)
  }
  throw new RangeError("Timeline timing requires at least one grid section")
}

export function timelineRowPositionAtBeatNumber(timing: BeatTiming, target: number): number {
  let rows = 0
  for (const [index, section] of timing.grid_sections.entries()) {
    const next = timing.grid_sections[index + 1]
    const nextPosition =
      next === undefined ? Number.POSITIVE_INFINITY : next.at.numerator / next.at.denominator
    if (target < nextPosition)
      return (
        rows +
        (Math.max(0, target - section.at.numerator / section.at.denominator) *
          section.rows_per_measure) /
          4
      )
    if (next !== undefined)
      rows += rowsBeforeBoundary(section.at, next.at, section.rows_per_measure)
  }
  throw new RangeError("Timeline timing requires at least one grid section")
}

export function snapBeatToTimelineRow(timing: BeatTiming, target: Beat): Beat {
  return beatAtTimelineRow(timing, timelineRowAtBeat(timing, target))
}

export function buildBeatCellIndex(
  notes: readonly BeatNote[],
  rows: readonly Beat[],
): ReadonlyMap<string, BeatTimelineCell> {
  const cells = new Map<string, BeatTimelineCell>()
  for (const note of notes) {
    const tail = beatAdd(note.at, note.hold)
    for (const row of rows) {
      if (beatCompare(row, note.at) < 0 || beatCompare(row, tail) > 0) continue
      const state = cellState(note, row, tail)
      for (let lane = 0; lane < 10; lane += 1) {
        if ((note.panel_mask & (1 << lane)) !== 0)
          cells.set(`${beatKey(row)}:${lane}`, { note, state })
      }
    }
  }
  return cells
}

export function beatTimelineExtent(
  timing: BeatTiming,
  notes: readonly BeatNote[],
  runwayRows: number,
): Beat {
  if (timing.duration !== null) return timing.duration
  const occupiedEnd = notes.reduce<Beat>((latest, note) => {
    const tail = beatAdd(note.at, note.hold)
    return beatCompare(tail, latest) > 0 ? tail : latest
  }, zero)
  const startRow = timelineRowAtBeat(timing, occupiedEnd)
  return beatAtTimelineRow(timing, startRow + runwayRows)
}

export function validateRowsPerMeasureChange(
  timing: BeatTiming,
  notes: readonly BeatNote[],
  at: Beat,
  rowsPerMeasure: number,
): SplitChangeResult {
  if (
    !Number.isSafeInteger(rowsPerMeasure) ||
    rowsPerMeasure < 1 ||
    rowsPerMeasure > MAX_EDIT_ROWS_PER_MEASURE
  )
    return {
      kind: "error",
      message: `Split must be between 1 and ${MAX_EDIT_ROWS_PER_MEASURE} rows per measure.`,
    }
  const gridSections = [
    ...timing.grid_sections.filter((section) => beatCompare(section.at, at) !== 0),
    { at, rows_per_measure: rowsPerMeasure },
  ].sort((left, right) => beatCompare(left.at, right.at))
  const candidate: BeatTiming = { ...timing, grid_sections: gridSections }
  for (const note of notes) {
    for (const position of [note.at, beatAdd(note.at, note.hold)]) {
      if (beatCompare(snapBeatToTimelineRow(candidate, position), position) !== 0)
        return {
          kind: "error",
          message: `The split would move an existing note at ${formatBeat(position)} beat.`,
        }
    }
  }
  return { kind: "success", timing: candidate }
}

export function beatKey(value: Beat): string {
  return `${value.numerator}/${value.denominator}`
}

export function formatBeat(value: Beat): string {
  return value.denominator === 1 ? String(value.numerator) : beatKey(value)
}

export function panelIndex(value: number): PanelIndex | null {
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
      return value
    default:
      return null
  }
}

function cellState(note: BeatNote, row: Beat, tail: Beat): BeatTimelineCellState {
  if (beatCompare(row, note.at) === 0)
    return beatCompare(note.hold, zero) === 0 ? "tap" : "hold-head"
  return beatCompare(row, tail) === 0 ? "hold-tail" : "hold-body"
}

function rowsBeforeBoundary(start: Beat, end: Beat, rowsPerMeasure: number): number {
  const distance = beatSubtract(end, start)
  const numerator = BigInt(distance.numerator) * BigInt(rowsPerMeasure)
  const denominator = BigInt(distance.denominator) * 4n
  return safeNumber((numerator + denominator - 1n) / denominator)
}

function floorRows(distance: Beat, rowsPerMeasure: number): number {
  if (distance.numerator < 0) return 0
  return safeNumber(
    (BigInt(distance.numerator) * BigInt(rowsPerMeasure)) / (BigInt(distance.denominator) * 4n),
  )
}

function rowsToBeats(rows: number, rowsPerMeasure: number): Beat {
  return reducedBeat(BigInt(rows) * BigInt(four.numerator), BigInt(rowsPerMeasure))
}

function reducedBeat(numerator: bigint, denominator: bigint): Beat {
  if (denominator <= 0n) throw new RangeError("Beat denominator must be positive")
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    numerator: safeNumber(numerator / divisor),
    denominator: safeNumber(denominator / divisor),
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let dividend = left < 0n ? -left : left
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
