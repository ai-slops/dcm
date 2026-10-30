import { describe, expect, it } from "vitest"

import type { BeatNote, BeatTiming } from "../shared/beat.ts"
import { BeatChartDocumentSchema } from "../shared/index.ts"
import { placeBeatHold, toggleBeatPanel } from "../src/domain/beat-editor.ts"
import { snapBeatToSelectedSplit } from "../src/domain/beat-timeline.ts"
import { setBeatDuration } from "../src/domain/beat-timing-inputs.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [{ at: beat(0), micros_per_beat: beat(500_000) }],
  grid_sections: [{ at: beat(0), rows_per_measure: 16 }],
  duration: null,
  reference_accents: [],
}

describe("beat-native direct editing", () => {
  it("deletes the complete hold when any occupied cell is toggled", () => {
    // Given a two-panel hold spanning beat one through beat two
    const notes: readonly BeatNote[] = [{ at: beat(1), hold: beat(1), panel_mask: 3 }]

    // When panel zero is clicked inside its hold body
    const edited = toggleBeatPanel(notes, timing, beat(3, 2), 0)

    // Then that panel's entire demand is removed while the chord peer remains exact
    expect(edited).toEqual([{ at: beat(1), hold: beat(1), panel_mask: 2 }])
  })

  it("creates a direction-independent inclusive hold on exact snapped rows", () => {
    // Given an empty chart with quarter-beat rows
    // When a drag travels upward from beat two to beat five quarters
    const edited = placeBeatHold([], timing, beat(2), beat(5, 4), 0)

    // Then the lower row is the head and the higher row is the inclusive tail
    expect(edited).toEqual([{ at: beat(5, 4), hold: beat(3, 4), panel_mask: 1 }])
  })

  it("rejects a hold collision without changing imported notes", () => {
    // Given an existing tap on the candidate tail
    const notes: readonly BeatNote[] = [{ at: beat(2), hold: beat(0), panel_mask: 1 }]

    // When a hold is dragged onto the occupied row
    const place = () => placeBeatHold(notes, timing, beat(1), beat(2), 0)

    // Then the atomic edit fails and preserves the original input
    expect(place).toThrow("already occupied")
    expect(notes).toEqual([{ at: beat(2), hold: beat(0), panel_mask: 1 }])
  })

  it("continues placing beyond the final note while duration is automatic", () => {
    // Given an automatic-duration chart whose last note is beat one
    const notes: readonly BeatNote[] = [{ at: beat(1), hold: beat(0), panel_mask: 1 }]

    // When an empty cell at beat nine is toggled
    const edited = toggleBeatPanel(notes, timing, beat(9), 1)

    // Then the new tap is appended without creating an explicit duration
    expect(edited).toEqual([
      { at: beat(1), hold: beat(0), panel_mask: 1 },
      { at: beat(9), hold: beat(0), panel_mask: 2 },
    ])
    expect(timing.duration).toBeNull()
  })

  it("deletes an imported off-grid demand without resnapping its stored beat", () => {
    // Given an imported third-beat note while the local editor uses quarter beats
    const notes: readonly BeatNote[] = [{ at: beat(1, 3), hold: beat(0), panel_mask: 1 }]

    // When its exact overlay is toggled
    const edited = toggleBeatPanel(notes, timing, beat(1, 3), 0)

    // Then deletion addresses the stored demand rather than the selected grid
    expect(edited).toEqual([])
    expect(notes).toEqual([{ at: beat(1, 3), hold: beat(0), panel_mask: 1 }])
  })

  it("places UI-snapped holds without consulting imported grid hints", () => {
    const importedTiming: BeatTiming = {
      ...timing,
      grid_sections: [{ at: beat(0), rows_per_measure: 12 }],
    }
    const head = snapBeatToSelectedSplit(beat(7, 6), 4)
    const tail = snapBeatToSelectedSplit(beat(11, 6), 4)

    const edited = placeBeatHold([], importedTiming, head, tail, 0)

    expect(edited).toEqual([{ at: beat(1), hold: beat(3, 4), panel_mask: 1 }])
    expect(importedTiming.grid_sections).toEqual([{ at: beat(0), rows_per_measure: 12 }])
  })
})

it("rejects an explicit duration on an occupied hold-tail cell before schema parsing", () => {
  // Given a valid document whose hold currently ends at beat two
  const project = BeatChartDocumentSchema.parse({
    schema_version: 1,
    title: "Duration boundary",
    artist: "Song artist",
    chart_artist: "Stepper",
    mode: "Double",
    timing: { ...timing, duration: beat(3) },
    notes: [{ at: beat(1), hold: beat(1), panel_mask: 1 }],
    audio_sha256: "0".repeat(64),
    audio_asset: { format: "wav", byte_length: 44 },
    evaluation_contract: {
      schema_version: 2,
      history_policy: { recent_window: 0, max_request_history: 0 },
      foot_model: {
        version: 1,
        micros_per_panel_unit: 100_000,
        bracket_setup_micros: 100_000,
        crossover_penalty: 2,
        bracket_penalty: 3,
      },
      difficulty: {
        label: "fixture",
        density: { minimum: 0, maximum: 100 },
        movement: { minimum: 0, maximum: 100 },
        brackets: { minimum: 0, maximum: 100 },
        hold_occupancy: { minimum: 0, maximum: 100 },
        local_load: { minimum: 0, maximum: 100 },
        total: { minimum: 0, maximum: 100 },
        local_windows: [],
      },
      intents: [],
      budgets: {
        max_notes: 10_000,
        max_frames: 10_000,
        max_dp_work: 1_000_000,
        max_matching_work: 1_000_000,
      },
    },
  })

  // When the requested duration equals that occupied tail
  const result = setBeatDuration(project, "2")

  // Then the typed timing edit reports truncation directly
  expect(result).toEqual({
    kind: "error",
    message: "The explicit duration would truncate a note or hold.",
  })
})
