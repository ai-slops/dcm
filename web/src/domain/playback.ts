import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { audioMicrosToTick, tickToAudioMicros } from "./timing.ts"

export const TAP_VISUAL_PULSE_MICROS = 120_000

export function chartTickAtAudioMicros(music: NativeMusic, audioMicros: number): number | null {
  if (audioMicros < music.offset_micros) return null
  return audioMicrosToTick(music, audioMicros)
}

export function activePanelMaskAtAudioMicros(
  chart: NativeChart,
  music: NativeMusic,
  audioMicros: number,
): number {
  return chart.notes.reduce((mask, note) => {
    const headMicros = tickToAudioMicros(music, note.tick)
    const tailMicros =
      note.hold_ticks === 0
        ? headMicros + TAP_VISUAL_PULSE_MICROS
        : tickToAudioMicros(music, note.tick + note.hold_ticks)
    const active = audioMicros >= headMicros && audioMicros < tailMicros
    return active ? mask | note.panel_mask : mask
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
