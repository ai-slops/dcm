import { describe, expect, it } from "vitest"

import type { BeatNote, BeatTiming } from "../shared/index.ts"
import { buildBeatChartPreviewIndex } from "../src/domain/beat-chart-preview.ts"
import { projectVisibleContacts } from "../src/domain/chart-preview.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [{ at: beat(0), micros_per_beat: { numerator: 500_300, denominator: 1 } }],
  grid_sections: [{ at: beat(0), rows_per_measure: 16_384 }],
  duration: beat(1),
  reference_accents: [],
}

describe("beat-native approach preview", () => {
  it("projects exact audio heads and tails beyond the native TPB limit", () => {
    // Given a hold whose beat denominator exceeds native 4096 TPB capability
    const notes: readonly BeatNote[] = [{ at: beat(1, 5_003), hold: beat(2, 5_003), panel_mask: 1 }]

    // When the beat source is indexed directly for preview
    const index = buildBeatChartPreviewIndex(notes, timing)

    // Then audio projection remains exact without a native tick adapter
    expect(index.contacts[0]).toMatchObject({
      at: beat(1, 5_003),
      hold: beat(2, 5_003),
      headMicros: 100,
      tailMicros: 300,
    })
  })

  it("keeps the contact window bounded with truthful overflow", () => {
    // Given six lane contacts inside one upcoming audio window
    const notes: readonly BeatNote[] = [
      { at: beat(1, 5_003), hold: beat(0), panel_mask: 0b0000000011 },
      { at: beat(2, 5_003), hold: beat(0), panel_mask: 0b0000001100 },
      { at: beat(3, 5_003), hold: beat(0), panel_mask: 0b0000110000 },
    ]

    // When the renderer requests only three contacts
    const projection = projectVisibleContacts({
      index: buildBeatChartPreviewIndex(notes, timing),
      audioMicros: 0,
      pastMicros: 0,
      lookaheadMicros: 1_000,
      contactCap: 3,
    })

    // Then beat/lane order is stable and the omitted count is disclosed
    expect(projection.contacts.map((contact) => [contact.at, contact.lane])).toEqual([
      [beat(1, 5_003), 0],
      [beat(1, 5_003), 1],
      [beat(2, 5_003), 2],
    ])
    expect(projection.hiddenContactCount).toBe(3)
  })

  it("keeps a beat hold visible after its head leaves the past window", () => {
    // Given a long hold whose tail still intersects the approach window
    const notes: readonly BeatNote[] = [{ at: beat(0), hold: beat(1, 2), panel_mask: 1 }]

    // When the media clock passes its head but not its tail
    const projection = projectVisibleContacts({
      index: buildBeatChartPreviewIndex(notes, timing),
      audioMicros: 200_000,
      pastMicros: 10_000,
      lookaheadMicros: 100_000,
      contactCap: 8,
    })

    // Then the intersecting hold remains rendered
    expect(projection.contacts).toHaveLength(1)
    expect(projection.contacts[0]?.kind).toBe("hold")
  })
})
