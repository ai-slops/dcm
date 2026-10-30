import { describe, expect, it } from "vitest"

import { beatUcsDocumentFor, NativeBeatUcsService } from "../../server/native/beat-ucs.ts"
import type { BeatChartCore } from "../../shared/beat.ts"
import { synthesizeUcsGridSections } from "../../shared/beat-ucs-output.ts"
import { repoRoot } from "../support/paths.ts"

function sourceWithNote(at: BeatChartCore["notes"][number]["at"]): BeatChartCore {
  return {
    mode: "Single",
    timing: {
      schema_version: 1,
      offset_micros: 0,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        },
      ],
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 }],
      duration: { numerator: 2, denominator: 1 },
      reference_accents: [],
    },
    notes: [{ at, hold: { numerator: 0, denominator: 1 }, panel_mask: 1 }],
  }
}

describe("beat native UCS refinement", () => {
  it("emits transient Split 12 for mixed thirds and quarters without mutating source", async () => {
    const base = sourceWithNote({ numerator: 1, denominator: 4 })
    const source: BeatChartCore = {
      ...base,
      notes: [
        {
          at: { numerator: 1, denominator: 4 },
          hold: { numerator: 0, denominator: 1 },
          panel_mask: 1,
        },
        {
          at: { numerator: 1, denominator: 3 },
          hold: { numerator: 1, denominator: 3 },
          panel_mask: 2,
        },
      ],
    }
    const before = structuredClone(source)

    const document = beatUcsDocumentFor(source)
    const bytes = await new NativeBeatUcsService(repoRoot).export(source)

    expect(document.grid_sections).toEqual([
      { at: { numerator: 0, denominator: 1 }, rows_per_measure: 48 },
    ])
    expect(new TextDecoder().decode(bytes)).toContain(":Split=12\r\n")
    expect(source).toEqual(before)
  })

  it("pads automatic extent by one active import-hint row before transient refinement", () => {
    const base = sourceWithNote({ numerator: 1, denominator: 4 })
    const source: BeatChartCore = {
      ...base,
      timing: { ...base.timing, duration: null },
      notes: [
        ...base.notes,
        {
          at: { numerator: 1, denominator: 3 },
          hold: { numerator: 0, denominator: 1 },
          panel_mask: 2,
        },
      ],
    }

    const document = beatUcsDocumentFor(source)

    expect(document.duration).toEqual({ numerator: 7, denominator: 12 })
    expect(document.grid_sections[0]?.rows_per_measure).toBe(48)
    expect(source.timing.duration).toBeNull()
  })

  it("uses a trusted automatic region end for trailing rests and region-only output", () => {
    // Given
    const base = sourceWithNote({ numerator: 3, denominator: 1 })
    const withTrailingRest: BeatChartCore = {
      ...base,
      timing: { ...base.timing, duration: null },
    }
    const regionOnly = { ...withTrailingRest, notes: [] }
    const context = { automatic_region_ends: [{ numerator: 4, denominator: 1 }] }

    // When
    const trailingRest = beatUcsDocumentFor(withTrailingRest, context)
    const emptyRegion = beatUcsDocumentFor(regionOnly, context)

    // Then
    expect(trailingRest.duration).toEqual({ numerator: 4, denominator: 1 })
    expect(emptyRegion.duration).toEqual({ numerator: 4, denominator: 1 })
    expect(withTrailingRest.timing.duration).toBeNull()
  })

  it("explains when exact UCS refinement exceeds Split 128", () => {
    const source = sourceWithNote({ numerator: 1, denominator: 129 })

    expect(() => beatUcsDocumentFor(source)).toThrowError(
      expect.objectContaining({
        code: "ucs_split_unsupported",
        message: expect.stringContaining("129 rows per beat"),
      }),
    )
  })

  it("returns a typed capability before exceeding 4096 output sections", () => {
    const timing = sourceWithNote({ numerator: 0, denominator: 1 }).timing
    const result = synthesizeUcsGridSections(
      {
        ...timing,
        tempo: Array.from({ length: 4_097 }, (_, numerator) => ({
          at: { numerator, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        })),
      },
      [],
      { numerator: 4_097, denominator: 1 },
    )

    expect(result).toEqual({
      kind: "unsupported",
      capability: { code: "ucs_section_limit", value: 4_097, limit: 4_096 },
    })
  })
})
