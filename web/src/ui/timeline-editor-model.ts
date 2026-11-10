import type { Beat, BeatNote, BeatTiming } from "../../shared/index.ts"
import {
  addBeats,
  automaticBeatOutputExtent,
  BeatTimingSchema,
  beatFromTicks,
  compareBeats,
  subtractBeats,
} from "../../shared/index.ts"
import type { TimelineRegion } from "./TimelineRows.tsx"

const zero = { numerator: 0, denominator: 1 } as const satisfies Beat

export function timelineRegionAtBeat(
  regions: readonly TimelineRegion[],
  at: Beat,
): TimelineRegion | undefined {
  return regions.find(
    (region) => compareBeats(region.start, at) <= 0 && compareBeats(at, region.end) < 0,
  )
}

export function initialTimelineSplit(timing: BeatTiming): number {
  return Math.min(
    128,
    Math.max(1, Math.round((timing.grid_sections[0]?.rows_per_measure ?? 16) / 4)),
  )
}

export function occupiedTimelineTail(notes: readonly BeatNote[]): Beat {
  return notes.reduce<Beat>((latest, note) => {
    const tail = addBeats(note.at, note.hold)
    return compareBeats(tail, latest) > 0 ? tail : latest
  }, zero)
}

export function timelineEndError(
  next: Beat,
  notes: readonly BeatNote[],
  regions: readonly TimelineRegion[],
): string | null {
  if (notes.length > 0 && compareBeats(next, occupiedTimelineTail(notes)) <= 0)
    return "The end line must stay after the final note or hold tail."
  const regionEnd = regions.reduce<Beat>(
    (latest, region) => (compareBeats(region.end, latest) > 0 ? region.end : latest),
    zero,
  )
  if (compareBeats(next, regionEnd) < 0) return "The end line cannot truncate an automatic region."
  return null
}

export function timelineTimingWithEnd(
  timing: BeatTiming,
  next: Beat | null,
  notes: readonly BeatNote[],
  regions: readonly TimelineRegion[],
):
  | { readonly kind: "success"; readonly timing: BeatTiming }
  | { readonly kind: "error"; readonly message: string } {
  const boundaryError = next === null ? null : timelineEndError(next, notes, regions)
  if (boundaryError !== null) return { kind: "error", message: boundaryError }
  const parsed = BeatTimingSchema.safeParse({ ...timing, duration: next })
  if (parsed.success) return { kind: "success", timing: parsed.data }
  return {
    kind: "error",
    message: parsed.error.issues[0]?.message ?? "The end line is invalid.",
  }
}

export { boundedTimelineNoteGeometry } from "@piu/chart-editor/geometry"

export function nudgeTimelineEnd(
  at: Beat,
  selectedSplit: number,
  direction: "earlier" | "later",
): Beat {
  const step = beatFromTicks(1, selectedSplit)
  if (direction === "later") return addBeats(at, step)
  return compareBeats(at, step) >= 0 ? subtractBeats(at, step) : zero
}

export function automaticTimelineEnd(
  timing: BeatTiming,
  notes: readonly BeatNote[],
  regions: readonly TimelineRegion[],
): Beat {
  const extent = automaticBeatOutputExtent({
    timing,
    notes,
    automatic_region_ends: regions.map((region) => region.end),
  })
  if (extent !== null) return extent
  return zero
}
