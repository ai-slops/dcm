import { describe, expect, it } from "vitest"

import type { BeatNote, BeatTiming } from "../shared/beat.ts"
import {
  beatAtTimelineRow,
  beatCompare,
  beatTimelineExtent,
  buildBeatCellIndex,
  snapBeatToTimelineRow,
  validateRowsPerMeasureChange,
} from "../src/domain/beat-timeline.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [{ at: beat(0), micros_per_beat: beat(500_000) }],
  grid_sections: [
    { at: beat(0), rows_per_measure: 4 },
    { at: beat(4), rows_per_measure: 16 },
  ],
  duration: null,
  reference_accents: [],
}

describe("beat-native timeline rows", () => {
  it("maps row ordinals through section-local splits without a global tick source", () => {
    // Given section zero has beat rows and section one has quarter-beat rows
    // When rows around the exact section boundary are resolved
    const beforeBoundary = beatAtTimelineRow(timing, 3)
    const boundary = beatAtTimelineRow(timing, 4)
    const afterBoundary = beatAtTimelineRow(timing, 5)

    // Then the section boundary stays exact and the new split owns following rows
    expect(beforeBoundary).toEqual(beat(3))
    expect(boundary).toEqual(beat(4))
    expect(afterBoundary).toEqual(beat(17, 4))
  })

  it("snaps placement down inside the active section using exact fractions", () => {
    // Given a pointer beat between quarter-beat rows in the second section
    // When it is snapped to the authored grid
    const snapped = snapBeatToTimelineRow(timing, beat(35, 8))

    // Then no decimal or native tick round-trip changes the source fraction
    expect(snapped).toEqual(beat(17, 4))
  })

  it("rejects a split change that would move an imported note or hold tail", () => {
    // Given an imported off-candidate note and hold tail that are valid today
    const notes: readonly BeatNote[] = [
      { at: beat(1, 3), hold: beat(0), panel_mask: 1 },
      { at: beat(1), hold: beat(1, 2), panel_mask: 2 },
    ]

    // When a four-row measure split is proposed at beat zero
    const result = validateRowsPerMeasureChange(timing, notes, beat(0), 4)

    // Then existing data is preserved by rejecting the incompatible split
    expect(result).toEqual({
      kind: "error",
      message: "The split would move an existing note at 1/3 beat.",
    })
  })

  it("indexes complete holds by exact row beat and deletes from any occupied cell", () => {
    // Given a half-beat hold beginning on beat four
    const notes: readonly BeatNote[] = [{ at: beat(4), hold: beat(1, 2), panel_mask: 1 }]

    // When visible section rows are indexed
    const cells = buildBeatCellIndex(notes, [beat(4), beat(17, 4), beat(9, 2)])

    // Then head, body, and inclusive tail all retain the owning note
    expect(cells.get("4/1:0")?.state).toBe("hold-head")
    expect(cells.get("17/4:0")?.state).toBe("hold-body")
    expect(cells.get("9/2:0")?.state).toBe("hold-tail")
    expect(cells.get("17/4:0")?.note).toBe(notes[0])
  })

  it("keeps automatic duration editable beyond the last occupied row", () => {
    // Given a chart whose final hold tail is beat six
    const notes: readonly BeatNote[] = [{ at: beat(5), hold: beat(1), panel_mask: 1 }]

    // When its virtual runway extent is requested
    const extent = beatTimelineExtent(timing, notes, 32)

    // Then the logical runway continues by the requested rendered rows
    expect(beatCompare(extent, beat(14))).toBe(0)
  })
})
