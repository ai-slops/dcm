import { describe, expect, it } from "vitest"

import type { BeatChartCore, BeatTiming } from "../shared/beat.ts"
import {
  automaticBeatOutputExtent,
  beatOutputContextFor,
  resolveChartOutputTiming,
} from "../shared/beat-output.ts"

const timing = {
  schema_version: 1,
  offset_micros: 0,
  tempo: [
    {
      at: { numerator: 0, denominator: 1 },
      micros_per_beat: { numerator: 500_000, denominator: 1 },
    },
  ],
  grid_sections: [
    { at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 },
    { at: { numerator: 2, denominator: 1 }, rows_per_measure: 12 },
  ],
  duration: null,
  reference_accents: [],
} as const

describe("beat output extent", () => {
  it("uses bounded lookups when notes precede many unused future grid hints", () => {
    let lookups = 0
    const sections: BeatTiming["grid_sections"][number][] = []
    for (let index = 0; index < 1_024; index += 1) {
      const section = {
        at: { numerator: index === 0 ? 0 : 10_000 + index, denominator: 1 },
        rows_per_measure: 16,
      }
      Object.defineProperty(sections, index, {
        get: () => {
          lookups += 1
          return section
        },
      })
    }
    const notes = Array.from({ length: 256 }, (_, numerator) => ({
      at: { numerator, denominator: 1 },
      hold: { numerator: 0, denominator: 1 },
      panel_mask: 1,
    }))

    const extent = automaticBeatOutputExtent({
      timing: { ...timing, grid_sections: sections },
      notes,
    })

    expect(extent).toEqual({ numerator: 1_021, denominator: 4 })
    expect(lookups).toBeLessThanOrEqual(notes.length * (Math.ceil(Math.log2(sections.length)) + 2))
  })

  it("pads exact note tails by one row from the active imported grid hint", () => {
    const extent = automaticBeatOutputExtent({
      timing,
      notes: [
        {
          at: { numerator: 7, denominator: 3 },
          hold: { numerator: 1, denominator: 3 },
          panel_mask: 1,
        },
      ],
    })

    expect(extent).toEqual({ numerator: 3, denominator: 1 })
  })

  it("uses automatic region exclusive ends exactly when they exceed padded note tails", () => {
    const extent = automaticBeatOutputExtent({
      timing,
      notes: [
        {
          at: { numerator: 1, denominator: 1 },
          hold: { numerator: 0, denominator: 1 },
          panel_mask: 1,
        },
      ],
      automatic_region_ends: [{ numerator: 7, denominator: 2 }],
    })

    expect(extent).toEqual({ numerator: 7, denominator: 2 })
  })

  it("resolves region-only automatic output from trusted document origin", () => {
    // Given
    const source: BeatChartCore = { mode: "Single", timing, notes: [] }
    const document = {
      origin: {
        automatic_regions: [
          {
            end: { numerator: 4, denominator: 1 },
          },
        ],
      },
    }

    // When
    const output = resolveChartOutputTiming(source, beatOutputContextFor(document))

    // Then
    expect(output?.duration).toEqual({ numerator: 4, denominator: 1 })
    expect(source.timing.duration).toBeNull()
    expect(document.origin.automatic_regions[0]?.end).toEqual({ numerator: 4, denominator: 1 })
  })

  it("keeps a valid explicit duration authoritative over automatic region ends", () => {
    // Given
    const source: BeatChartCore = {
      mode: "Single",
      timing: { ...timing, duration: { numerator: 2, denominator: 1 } },
      notes: [],
    }
    const context = { automatic_region_ends: [{ numerator: 4, denominator: 1 }] }

    // When
    const output = resolveChartOutputTiming(source, context)

    // Then
    expect(output?.duration).toEqual({ numerator: 2, denominator: 1 })
  })
})
