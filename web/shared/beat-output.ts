import {
  addBeats,
  type Beat,
  type BeatChartCore,
  type BeatTiming,
  BeatTimingSchema,
  compareBeats,
} from "./beat.ts"

export function resolveChartOutputTiming(source: BeatChartCore): BeatTiming | null {
  const duration = source.timing.duration ?? automaticChartDuration(source)
  return duration === null ? null : timingAtOutputExtent(source.timing, duration)
}

export function timingAtOutputExtent(timing: BeatTiming, duration: Beat): BeatTiming {
  return BeatTimingSchema.parse({
    ...timing,
    duration,
    tempo: timing.tempo.filter((segment) => compareBeats(segment.at, duration) < 0),
    grid_sections: timing.grid_sections.filter((section) => compareBeats(section.at, duration) < 0),
    reference_accents: timing.reference_accents.filter(
      (accent) => compareBeats(accent, duration) < 0,
    ),
  })
}

function automaticChartDuration(source: BeatChartCore): Beat | null {
  let occupied: Beat | null = null
  for (const note of source.notes) {
    const end = addBeats(note.at, note.hold)
    if (occupied === null || compareBeats(end, occupied) > 0) occupied = end
  }
  if (occupied === null) return null
  const grid = [...source.timing.grid_sections]
    .reverse()
    .find((section) => compareBeats(section.at, occupied) <= 0)
  return grid === undefined
    ? null
    : addBeats(occupied, { numerator: 4, denominator: grid.rows_per_measure })
}
