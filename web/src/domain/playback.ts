import type { Beat, BeatNote, BeatTiming } from "../../shared/beat.ts"
import { addBeats, compareBeats } from "../../shared/beat.ts"
import { audioMicrosToBeatPosition, beatToAudioMicros } from "./beat-timing.ts"

export const TAP_VISUAL_PULSE_MICROS = 120_000

export type NoteAudioInterval = {
  readonly panelMask: number
  readonly headMicros: number
  readonly tailMicros: number
}

export function chartBeatAtAudioMicros(timing: BeatTiming, audioMicros: number): number | null {
  return audioMicrosToBeatPosition(timing, audioMicros)
}

export function buildNoteAudioIntervals(
  notes: readonly BeatNote[],
  timing: BeatTiming,
): readonly NoteAudioInterval[] {
  return notes.map((note) => {
    const headMicros = beatToAudioMicros(timing, note.at)
    return {
      panelMask: note.panel_mask,
      headMicros,
      tailMicros:
        note.hold.numerator === 0
          ? headMicros + TAP_VISUAL_PULSE_MICROS
          : beatToAudioMicros(timing, addBeats(note.at, note.hold)),
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

export function activePanelMaskAtBeat(notes: readonly BeatNote[], at: Beat): number {
  return notes.reduce((mask, note) => {
    const tail = addBeats(note.at, note.hold)
    const active =
      note.hold.numerator === 0
        ? compareBeats(note.at, at) === 0
        : compareBeats(note.at, at) <= 0 && compareBeats(at, tail) < 0
    return active ? mask | note.panel_mask : mask
  }, 0)
}
