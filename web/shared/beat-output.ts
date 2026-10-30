import {
  addBeats,
  type Beat,
  type BeatChartCore,
  type BeatNote,
  type BeatTiming,
  BeatTimingSchema,
  compareBeats,
} from "./beat.ts"

export type BeatOutputContext = {
  readonly automatic_region_ends?: readonly Beat[]
}

type AutomaticRegionDocument = {
  readonly origin?:
    | {
        readonly automatic_regions: readonly { readonly end: Beat }[]
      }
    | undefined
}

export function beatOutputContextFor(document: AutomaticRegionDocument): BeatOutputContext {
  return document.origin === undefined
    ? {}
    : { automatic_region_ends: document.origin.automatic_regions.map((region) => region.end) }
}

export function resolveChartOutputTiming(
  source: BeatChartCore,
  context: BeatOutputContext = {},
): BeatTiming | null {
  const duration =
    source.timing.duration ??
    automaticBeatOutputExtent({
      timing: source.timing,
      notes: source.notes,
      ...context,
    })
  return duration === null ? null : timingAtOutputExtent(source.timing, duration)
}

export function automaticBeatOutputExtent(input: {
  readonly timing: BeatTiming
  readonly notes: readonly BeatNote[]
  readonly automatic_region_ends?: readonly Beat[]
}): Beat | null {
  let occupied: Beat | null = null
  for (const regionEnd of input.automatic_region_ends ?? [])
    if (occupied === null || compareBeats(regionEnd, occupied) > 0) occupied = regionEnd
  for (const note of input.notes) {
    const end = addBeats(note.at, note.hold)
    let low = 0
    let high = input.timing.grid_sections.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const section = input.timing.grid_sections[middle]
      if (section !== undefined && compareBeats(section.at, end) <= 0) low = middle + 1
      else high = middle
    }
    const grid = input.timing.grid_sections[low - 1]
    if (grid === undefined) continue
    const padded = addBeats(end, { numerator: 4, denominator: grid.rows_per_measure })
    if (occupied === null || compareBeats(padded, occupied) > 0) occupied = padded
  }
  return occupied
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
