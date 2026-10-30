import { expect, it } from "vitest"

import { beatUcsDocumentFor } from "../../server/native/beat-ucs.ts"
import { BeatChartCoreSchema } from "../../shared/beat.ts"

it("lets the direct end line precede unused timing hints without deleting them", () => {
  const zero = { numerator: 0, denominator: 1 }
  const future = { numerator: 4, denominator: 1 }
  const source = BeatChartCoreSchema.parse({
    mode: "Single",
    timing: {
      schema_version: 1,
      offset_micros: 0,
      duration: { numerator: 2, denominator: 1 },
      tempo: [
        { at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } },
        { at: future, micros_per_beat: { numerator: 400_000, denominator: 1 } },
      ],
      grid_sections: [
        { at: zero, rows_per_measure: 16 },
        { at: future, rows_per_measure: 12 },
      ],
      reference_accents: [future],
    },
    notes: [{ at: { numerator: 1, denominator: 1 }, hold: zero, panel_mask: 1 }],
  })

  const output = beatUcsDocumentFor(source)

  expect(output.duration).toEqual({ numerator: 2, denominator: 1 })
  expect(output.tempo).toHaveLength(1)
  expect(output.grid_sections).toHaveLength(1)
  expect(source.timing.tempo[1]?.at).toEqual(future)
  expect(source.timing.grid_sections[1]?.at).toEqual(future)
  expect(source.timing.reference_accents).toEqual([future])
})
