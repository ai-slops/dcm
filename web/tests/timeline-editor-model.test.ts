import { expect, it } from "vitest"

import type { BeatTiming } from "../shared/index.ts"
import {
  automaticTimelineEnd,
  boundedTimelineNoteGeometry,
  nudgeTimelineEnd,
  timelineEndError,
} from "../src/ui/timeline-editor-model.ts"

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [
    {
      at: { numerator: 0, denominator: 1 },
      micros_per_beat: { numerator: 500_000, denominator: 1 },
    },
  ],
  grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 }],
  duration: null,
  reference_accents: [],
}

it("keeps the empty automatic end at beat zero", () => {
  // Given a source with no notes or automatic regions
  // When its automatic extent is resolved for the editor
  const extent = automaticTimelineEnd(timing, [], [])

  // Then the stable import hint remains beat zero rather than moving with the local grid
  expect(extent).toEqual({ numerator: 0, denominator: 1 })
})

it("rejects an end on a note tail but accepts a region-exclusive end", () => {
  // Given a hold ending at beat two and an automatic region ending at beat four
  const notes = [
    { at: { numerator: 1, denominator: 1 }, hold: { numerator: 1, denominator: 1 }, panel_mask: 1 },
  ]
  const regions = [
    {
      id: "region",
      name: "Trailing rest",
      start: { numerator: 2, denominator: 1 },
      end: { numerator: 4, denominator: 1 },
    },
  ]

  // When candidate ends meet each occupied boundary
  const noteTailError = timelineEndError({ numerator: 2, denominator: 1 }, notes, regions)
  const regionTruncationError = timelineEndError({ numerator: 3, denominator: 1 }, notes, regions)
  const regionEndError = timelineEndError({ numerator: 4, denominator: 1 }, notes, regions)

  // Then notes require a strictly later end while the exclusive region end may match
  expect(noteTailError).toBe("The end line must stay after the final note or hold tail.")
  expect(regionTruncationError).toBe("The end line cannot truncate an automatic region.")
  expect(regionEndError).toBeNull()
})

it("clips a huge offscreen hold to the visible runway segment", () => {
  // Given authored hold geometry extending well beyond both ends of the runway
  const input = {
    headY: -2_000_000,
    tailY: 8_000_000,
    visibleStartY: 1_900_000,
    visibleEndY: 2_100_000,
    runwaySize: 4_000_000,
  }

  // When its render geometry is bounded
  const geometry = boundedTimelineNoteGeometry(input)

  // Then only the visible segment contributes DOM size
  expect(geometry).toEqual({ insetBlockStart: 1_900_000, blockSize: 200_000 })
})

it("nudges an end by one exact selected-split row", () => {
  // Given an end at one third while the local authoring split is twelve rows per beat
  const at = { numerator: 1, denominator: 3 }

  // When the end moves one row in each direction
  const later = nudgeTimelineEnd(at, 12, "later")
  const earlier = nudgeTimelineEnd(at, 12, "earlier")

  // Then both results retain reduced exact fractions
  expect(later).toEqual({ numerator: 5, denominator: 12 })
  expect(earlier).toEqual({ numerator: 1, denominator: 4 })
})
