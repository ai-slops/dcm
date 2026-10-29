import { describe, expect, it } from "vitest"

import {
  beatUcsDocumentFor,
  NativeBeatUcsService,
  parseBeatUcsImport,
} from "../../server/native/beat-ucs.ts"
import type { BeatChartCore } from "../../shared/beat.ts"
import { repoRoot } from "../support/paths.ts"

describe("beat native UCS adapter", () => {
  it("maps native beat output into the shared authoring contract without tick conversion", () => {
    const result = parseBeatUcsImport(
      JSON.stringify({
        mode: "Single",
        offset_micros: 125_000,
        tempo: [
          {
            at: { numerator: 0, denominator: 1 },
            micros_per_beat: { numerator: 500_000, denominator: 1 },
          },
        ],
        grid_sections: [
          { at: { numerator: 0, denominator: 1 }, rows_per_measure: 508 },
          { at: { numerator: 128, denominator: 127 }, rows_per_measure: 452 },
        ],
        duration: { numerator: 28942, denominator: 14351 },
        notes: [
          {
            at: { numerator: 128, denominator: 127 },
            hold: { numerator: 0, denominator: 1 },
            panel_mask: 1,
          },
        ],
        audio_sha256: Array.from({ length: 32 }, () => 9),
        reference_accents: [],
      }),
    )

    expect(result.timing.grid_sections[1]).toEqual({
      at: { numerator: 128, denominator: 127 },
      rows_per_measure: 452,
    })
    expect(result.notes[0]?.at).toEqual({ numerator: 128, denominator: 127 })
  })

  it("derives output-only automatic extent and trims future timing markers", () => {
    const source: BeatChartCore = {
      mode: "Single",
      timing: {
        schema_version: 1,
        offset_micros: 0,
        tempo: [
          {
            at: { numerator: 0, denominator: 1 },
            micros_per_beat: { numerator: 500_000, denominator: 1 },
          },
          {
            at: { numerator: 2, denominator: 1 },
            micros_per_beat: { numerator: 400_000, denominator: 1 },
          },
        ],
        grid_sections: [
          { at: { numerator: 0, denominator: 1 }, rows_per_measure: 12 },
          { at: { numerator: 2, denominator: 1 }, rows_per_measure: 508 },
        ],
        duration: null,
        reference_accents: [{ numerator: 2, denominator: 1 }],
      },
      notes: [
        {
          at: { numerator: 1, denominator: 3 },
          hold: { numerator: 2, denominator: 3 },
          panel_mask: 1,
        },
      ],
    }

    const output = beatUcsDocumentFor(source)

    expect(output.duration).toEqual({ numerator: 4, denominator: 3 })
    expect(output.tempo).toHaveLength(1)
    expect(output.grid_sections).toHaveLength(1)
    expect(output.reference_accents).toEqual([])
    expect(source.timing.duration).toBeNull()
  })

  it("exports nonempty automatic extent through the real native CLI", async () => {
    const source: BeatChartCore = {
      mode: "Single",
      timing: {
        schema_version: 1,
        offset_micros: 0,
        tempo: [
          {
            at: { numerator: 0, denominator: 1 },
            micros_per_beat: { numerator: 500_000, denominator: 1 },
          },
          {
            at: { numerator: 2, denominator: 1 },
            micros_per_beat: { numerator: 400_000, denominator: 1 },
          },
        ],
        grid_sections: [
          { at: { numerator: 0, denominator: 1 }, rows_per_measure: 12 },
          { at: { numerator: 2, denominator: 1 }, rows_per_measure: 508 },
        ],
        duration: null,
        reference_accents: [],
      },
      notes: [
        {
          at: { numerator: 1, denominator: 3 },
          hold: { numerator: 2, denominator: 3 },
          panel_mask: 1,
        },
      ],
    }

    const bytes = await new NativeBeatUcsService(repoRoot).export(source)
    const text = new TextDecoder().decode(bytes)

    expect(text).toContain(":Split=3\r\n")
    expect(text).not.toContain(":Split=127\r\n")
    expect(text.match(/^[.MHW]{5}\r?$/gm)).toHaveLength(4)
    expect(source.timing.duration).toBeNull()
  })

  it("rejects empty automatic extent with a typed boundary error", () => {
    const source: BeatChartCore = {
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
        grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 4 }],
        duration: null,
        reference_accents: [],
      },
      notes: [],
    }

    expect(() => beatUcsDocumentFor(source)).toThrowError(
      expect.objectContaining({ code: "empty_auto_extent" }),
    )
  })
})
