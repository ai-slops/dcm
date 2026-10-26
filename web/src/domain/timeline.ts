import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { tickToAudioMicros } from "./timing.ts"

export const TIMELINE_WINDOW_ROWS = 48

export type TimelineCellState = "tap" | "hold-head" | "hold-body" | "hold-tail"

type TimelineWindowInput = {
  readonly sourceTick: number
  readonly quantize: number
  readonly spanTicks: number
}

export type TimingContext = {
  readonly beat: string
  readonly bpm: number
  readonly songTime: string
  readonly offset: string
}

const statePriority: Readonly<Record<TimelineCellState, number>> = {
  "hold-body": 1,
  "hold-tail": 2,
  "hold-head": 3,
  tap: 4,
}

export function timelineWindowStart(input: TimelineWindowInput): number {
  const pageTicks = input.quantize * TIMELINE_WINDOW_ROWS
  const boundedTick = Math.min(Math.max(input.sourceTick, 0), Math.max(input.spanTicks - 1, 0))
  return Math.floor(boundedTick / pageTicks) * pageTicks
}

export function buildVisibleCellIndex(
  chart: NativeChart,
  startTick: number,
  quantize: number,
  rowCount: number,
): ReadonlyMap<string, TimelineCellState> {
  const cells = new Map<string, TimelineCellState>()
  const endTick = startTick + quantize * rowCount
  for (const note of chart.notes) {
    const noteEnd = note.tick + note.hold_ticks
    if (note.tick >= endTick || noteEnd < startTick) continue
    for (let panel = 0; panel < 10; panel += 1) {
      if ((note.panel_mask & (1 << panel)) === 0) continue
      const firstRow = Math.max(
        0,
        Math.ceil((Math.max(note.tick, startTick) - startTick) / quantize),
      )
      const lastRow = Math.min(
        rowCount - 1,
        Math.floor((Math.min(noteEnd, endTick - 1) - startTick) / quantize),
      )
      for (let row = firstRow; row <= lastRow; row += 1) {
        const tick = startTick + row * quantize
        const state = cellState(note.tick, note.hold_ticks, tick)
        if (state !== null) setCell(cells, `${tick}:${panel}`, state)
      }
    }
  }
  return cells
}

export function timingContextAtTick(
  music: NativeMusic,
  tick: number,
  audioMicros = tickToAudioMicros(music, tick),
): TimingContext {
  const boundedTick = Math.min(Math.max(tick, 0), music.duration_ticks)
  const segment = [...music.tempo].reverse().find((item) => item.start_tick <= boundedTick)
  const microsPerBeat = segment?.micros_per_beat
  const bpm =
    microsPerBeat === undefined
      ? 0
      : (60_000_000 * microsPerBeat.denominator) / microsPerBeat.numerator
  return {
    beat: formatBeat(boundedTick, music.ticks_per_beat),
    bpm,
    songTime: formatSongTime(audioMicros),
    offset: formatOffset(music.offset_micros),
  }
}

function cellState(noteTick: number, holdTicks: number, tick: number): TimelineCellState | null {
  if (tick === noteTick) return holdTicks === 0 ? "tap" : "hold-head"
  if (holdTicks === 0 || tick > noteTick + holdTicks) return null
  return tick === noteTick + holdTicks ? "hold-tail" : "hold-body"
}

function setCell(
  cells: Map<string, TimelineCellState>,
  key: string,
  state: TimelineCellState,
): void {
  const current = cells.get(key)
  if (current === undefined || statePriority[state] > statePriority[current]) cells.set(key, state)
}

function formatSongTime(audioMicros: number): string {
  const absoluteMillis = Math.round(Math.abs(audioMicros) / 1_000)
  const minutes = Math.floor(absoluteMillis / 60_000)
  const seconds = Math.floor((absoluteMillis % 60_000) / 1_000)
  const millis = absoluteMillis % 1_000
  const sign = audioMicros < 0 ? "−" : ""
  return `${sign}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

function formatOffset(offsetMicros: number): string {
  const prefix = offsetMicros >= 0 ? "+" : "−"
  const milliseconds = (Math.abs(offsetMicros) / 1_000)
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")
  return `${prefix}${milliseconds} ms`
}

function formatBeat(tick: number, ticksPerBeat: number): string {
  if (!Number.isInteger(tick)) {
    const decimal = (tick / ticksPerBeat)
      .toFixed(3)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1")
    return `≈${decimal}`
  }
  const divisor = greatestCommonDivisor(tick, ticksPerBeat)
  return `${tick / divisor}/${ticksPerBeat / divisor}`
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = Math.abs(left)
  let divisor = Math.abs(right)
  while (divisor !== 0) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend === 0 ? 1 : dividend
}
