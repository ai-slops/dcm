import type { StudioProjectV1 } from "../../shared/project.ts"

export function chartSummary(project: StudioProjectV1) {
  return {
    note_count: project.chart.notes.reduce((total, note) => total + bitCount(note.panel_mask), 0),
    hold_count: project.chart.notes.reduce(
      (total, note) => total + (note.hold_ticks > 0 ? bitCount(note.panel_mask) : 0),
      0,
    ),
    ticks_per_beat: project.chart.ticks_per_beat,
    duration_ticks: project.chart.span_ticks,
  }
}

export function hexDigest(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function bitCount(value: number): number {
  let remaining = value
  let count = 0
  while (remaining !== 0) {
    count += remaining & 1
    remaining >>>= 1
  }
  return count
}
