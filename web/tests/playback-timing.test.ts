import { describe, expect, it } from "vitest"

import type { BeatNote, BeatTiming } from "../shared/index.ts"
import {
  activePanelMaskAtAudioIntervals,
  activePanelMaskAtBeat,
  buildNoteAudioIntervals,
  chartBeatAtAudioMicros,
} from "../src/domain/playback.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 100_000,
  tempo: [{ at: beat(0), micros_per_beat: beat(500_000) }],
  grid_sections: [{ at: beat(0), rows_per_measure: 16 }],
  duration: beat(4),
  reference_accents: [],
}

describe("beat playback clock boundaries", () => {
  it("keeps the judgment position absent before a positive chart offset", () => {
    // Given beat zero starts 100 ms into the audio
    // When the media clock is one microsecond before the offset
    const position = chartBeatAtAudioMicros(timing, 99_999)

    // Then no future beat is painted early
    expect(position).toBeNull()
  })

  it("releases a hold at its exclusive beat tail", () => {
    // Given a one-beat hold starting at beat zero
    const notes: readonly BeatNote[] = [{ at: beat(0), hold: beat(1), panel_mask: 1 }]
    const intervals = buildNoteAudioIntervals(notes, timing)

    // When the audio clock reaches the exact tail time
    const mask = activePanelMaskAtAudioIntervals(intervals, 600_000)

    // Then the panel is no longer active
    expect(mask).toBe(0)
  })

  it("shows a tap only for the documented 120 ms pulse", () => {
    // Given a tap at beat zero
    const intervals = buildNoteAudioIntervals(
      [{ at: beat(0), hold: beat(0), panel_mask: 4 }],
      timing,
    )

    // When sampling immediately before and at the pulse boundary
    const during = activePanelMaskAtAudioIntervals(intervals, 219_999)
    const after = activePanelMaskAtAudioIntervals(intervals, 220_000)

    // Then the pulse is active only inside the half-open interval
    expect(during).toBe(4)
    expect(after).toBe(0)
  })
})

describe("stopped beat preview", () => {
  it("highlights a tap only at its exact rational beat", () => {
    // Given a tap at beat one third
    const notes: readonly BeatNote[] = [{ at: beat(1, 3), hold: beat(0), panel_mask: 8 }]

    // When adjacent and exact fractions are previewed
    const adjacent = activePanelMaskAtBeat(notes, beat(333, 1_000))
    const exact = activePanelMaskAtBeat(notes, beat(1, 3))

    // Then exact beat identity controls the contact
    expect(adjacent).toBe(0)
    expect(exact).toBe(8)
  })
})
