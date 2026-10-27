import type { AutomaticRegionView, NativeChart, NativeMusic } from "../../shared/index.ts"
import {
  TIMELINE_RUNWAY_CENTER_ROW,
  timelineLogicalVisibleTick,
} from "./timeline-scroll-geometry.ts"
import { bpmAtTick, tickToAudioMicros } from "./timing.ts"

export * from "./timeline-scroll-geometry.ts"

export const TIMELINE_WINDOW_ROWS = 48
export const TIMELINE_BUFFER_ROWS = 16

export type TimelineCellState = "tap" | "hold-head" | "hold-body" | "hold-tail"
export type LaneTone = "blue" | "red" | "yellow"

type TimelineWindowInput = {
  readonly sourceTick: number
  readonly spanTicks: number
}

type TimelineVirtualWindowInput = {
  readonly originTick: number
  readonly scrollTop: number
  readonly rowSize: number
  readonly viewportSize: number
  readonly spanTicks: number
}

export type TimelineVirtualWindow = {
  readonly visibleTick: number
  readonly startTick: number
  readonly rows: readonly number[]
  readonly offset: number
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
  const pageTicks = TIMELINE_WINDOW_ROWS
  const boundedTick = Math.min(Math.max(input.sourceTick, 0), Math.max(input.spanTicks - 1, 0))
  return Math.floor(boundedTick / pageTicks) * pageTicks
}

export function laneTone(lane: number): LaneTone {
  const position = ((lane % 5) + 5) % 5
  if (position === 2) return "yellow"
  return position === 0 || position === 4 ? "blue" : "red"
}

export function timelineRangeIntersectsRegions(
  startTick: number,
  endTick: number,
  regions: readonly AutomaticRegionView[],
): boolean {
  const first = Math.min(startTick, endTick)
  const last = Math.max(startTick, endTick)
  return regions.some((region) => region.start_tick <= last && region.end_tick > first)
}

export function timelineVirtualWindow(input: TimelineVirtualWindowInput): TimelineVirtualWindow {
  const viewportRows = Math.max(1, Math.ceil(input.viewportSize / input.rowSize))
  const visibleTick = timelineLogicalVisibleTick(input)
  const startTick = Math.max(0, Math.floor(visibleTick) - TIMELINE_BUFFER_ROWS)
  const endTick = Math.min(
    input.spanTicks,
    Math.ceil(visibleTick) + viewportRows + TIMELINE_BUFFER_ROWS,
  )
  return {
    visibleTick,
    startTick,
    rows: Array.from({ length: endTick - startTick }, (_, index) => startTick + index),
    offset: (TIMELINE_RUNWAY_CENTER_ROW + startTick - input.originTick) * input.rowSize,
  }
}

export function buildVisibleCellIndex(
  chart: NativeChart,
  startTick: number,
  rowCount = TIMELINE_WINDOW_ROWS,
): ReadonlyMap<string, TimelineCellState> {
  const cells = new Map<string, TimelineCellState>()
  const endTick = startTick + rowCount
  for (const note of chart.notes) {
    const noteEnd = note.tick + note.hold_ticks
    if (note.tick >= endTick || noteEnd < startTick) continue
    for (let panel = 0; panel < 10; panel += 1) {
      if ((note.panel_mask & (1 << panel)) === 0) continue
      const firstTick = Math.max(note.tick, startTick)
      const lastTick = Math.min(noteEnd, endTick - 1)
      for (let tick = firstTick; tick <= lastTick; tick += 1) {
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
  return {
    beat: formatBeat(boundedTick, music.ticks_per_beat),
    bpm: bpmAtTick(music, boundedTick),
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
