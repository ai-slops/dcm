import { describe, expect, it } from "vitest"

import type { BeatTiming } from "../shared/index.ts"
import {
  addTempoMarker,
  removeTempoMarker,
  updateTempoMarker,
} from "../src/domain/beat-timing-inputs.ts"

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

describe("timeline tempo edits", () => {
  it("adds, updates, and removes a marker through timing-only inputs", () => {
    // Given the timeline owns a timing map without the rest of the document
    const added = addTempoMarker(timing, "2", "150")
    expect(added.kind).toBe("success")
    if (added.kind === "error") return

    // When the same direct-action dialog updates and removes that marker
    const updated = updateTempoMarker(added.timing, 1, "2", "180")
    expect(updated.kind).toBe("success")
    if (updated.kind === "error") return
    const removed = removeTempoMarker(updated.timing, 1)

    // Then the helper preserves the base marker and returns a valid timing map
    expect(removed).toEqual({ kind: "success", timing })
  })

  it("keeps the base beat-zero marker non-removable", () => {
    // Given the required base tempo marker
    // When removal is requested from the BPM-only dialog
    const result = removeTempoMarker(timing, 0)

    // Then the map is rejected without mutation
    expect(result).toEqual({ kind: "error", message: "The base tempo marker cannot be removed." })
  })
})
