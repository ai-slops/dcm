import type { Beat } from "../../shared/beat.ts"
import { compareBeats } from "../../shared/beat.ts"
import type { PanelIndex } from "./editor.ts"

export type { BeatTimelinePoint, BeatTimelinePointsInput } from "./beat-timeline-points.ts"
export {
  beatTimelinePointsInAudioRange,
  MAX_SELECTED_BEAT_SPLIT,
  snapBeatToSelectedSplit,
} from "./beat-timeline-points.ts"

export type LaneTone = "blue" | "red" | "yellow"

export const beatCompare = compareBeats

export function laneTone(lane: number): LaneTone {
  const position = ((lane % 5) + 5) % 5
  if (position === 2) return "yellow"
  return position === 0 || position === 4 ? "blue" : "red"
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
