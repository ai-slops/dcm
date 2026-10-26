import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { audioMicrosToTick, tickToAudioMicros } from "./timing.ts"

export const TAP_VISUAL_PULSE_MICROS = 120_000

export type NoteAudioInterval = {
  readonly panelMask: number
  readonly headMicros: number
  readonly tailMicros: number
}

export function chartTickAtAudioMicros(music: NativeMusic, audioMicros: number): number | null {
  if (audioMicros < music.offset_micros) return null
  return audioMicrosToTick(music, audioMicros)
}

export function activePanelMaskAtAudioMicros(
  chart: NativeChart,
  music: NativeMusic,
  audioMicros: number,
): number {
  return activePanelMaskAtAudioIntervals(buildNoteAudioIntervals(chart, music), audioMicros)
}

export function buildNoteAudioIntervals(
  chart: NativeChart,
  music: NativeMusic,
): readonly NoteAudioInterval[] {
  return chart.notes.map((note) => {
    const headMicros = tickToAudioMicros(music, note.tick)
    return {
      panelMask: note.panel_mask,
      headMicros,
      tailMicros:
        note.hold_ticks === 0
          ? headMicros + TAP_VISUAL_PULSE_MICROS
          : tickToAudioMicros(music, note.tick + note.hold_ticks),
    }
  })
}

export function activePanelMaskAtAudioIntervals(
  intervals: readonly NoteAudioInterval[],
  audioMicros: number,
): number {
  return intervals.reduce((mask, interval) => {
    const active = audioMicros >= interval.headMicros && audioMicros < interval.tailMicros
    return active ? mask | interval.panelMask : mask
  }, 0)
}

export function activePanelMaskAtSelectedTick(chart: NativeChart, tick: number): number {
  return chart.notes.reduce((mask, note) => {
    const active =
      note.hold_ticks === 0
        ? note.tick === tick
        : note.tick <= tick && tick < note.tick + note.hold_ticks
    return active ? mask | note.panel_mask : mask
  }, 0)
}
