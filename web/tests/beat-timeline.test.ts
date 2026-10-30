import { describe, expect, it } from "vitest"

import type { BeatTiming } from "../shared/beat.ts"
import {
  beatCompare,
  beatTimelinePointsInAudioRange,
  snapBeatToSelectedSplit,
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

describe("audio-time beat timeline", () => {
  it("snaps only new input to the selected per-beat split", () => {
    // Given a pointer fraction between quarter-beat candidates
    // When the local edit split snaps it down
    const snapped = snapBeatToSelectedSplit(beat(7, 6), 4)

    // Then the result is reduced exactly without consulting source grid hints
    expect(snapped).toEqual(beat(1))
    expect(timing.grid_sections).toEqual([
      { at: beat(0), rows_per_measure: 4 },
      { at: beat(4), rows_per_measure: 16 },
    ])
  })

  it("keeps exact mixed-source notes at the same audio position when the local split changes", () => {
    const mixedTiming: BeatTiming = {
      ...timing,
      offset_micros: 100_000,
      tempo: [
        { at: beat(0), micros_per_beat: beat(500_000) },
        { at: beat(1), micros_per_beat: beat(250_000) },
      ],
    }
    const sourceNote = beat(1, 3)
    const input = {
      timing: mixedTiming,
      range: { startMicros: 100_000, endMicros: 850_000 },
      exactBeats: [sourceNote, beat(3, 2)],
    }

    const splitThree = beatTimelinePointsInAudioRange({ ...input, selectedSplit: 3 })
    const splitFour = beatTimelinePointsInAudioRange({ ...input, selectedSplit: 4 })

    expect(
      splitThree.find(
        (point) => point.kind === "exact" && beatCompare(point.beat, sourceNote) === 0,
      ),
    ).toEqual({ beat: sourceNote, audioMicros: 266_666.6666666666, kind: "exact" })
    expect(
      splitFour.find(
        (point) => point.kind === "exact" && beatCompare(point.beat, sourceNote) === 0,
      ),
    ).toEqual({ beat: sourceNote, audioMicros: 266_666.6666666666, kind: "exact" })
    expect(splitFour.find((point) => beatCompare(point.beat, beat(3, 2)) === 0)?.audioMicros).toBe(
      725_000,
    )
  })

  it("bounds generated grid candidates while retaining visible exact overlays", () => {
    const exact = beat(1, 3)

    const points = beatTimelinePointsInAudioRange({
      timing,
      selectedSplit: 128,
      range: { startMicros: 0, endMicros: 2_000_000 },
      exactBeats: [exact],
      maximumGridPoints: 8,
    })

    expect(points.filter((point) => point.kind === "grid")).toHaveLength(8)
    expect(
      points.some((point) => point.kind === "exact" && beatCompare(point.beat, exact) === 0),
    ).toBe(true)
  })
})
