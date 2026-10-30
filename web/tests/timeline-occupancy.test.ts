import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { type BeatNote, type BeatTiming, beatFromTicks } from "../shared/beat.ts"
import { TimelineRows } from "../src/ui/TimelineRows.tsx"

it("bounds occupied-cell lookups when the viewport follows many earlier notes", () => {
  let lookups = 0
  const notes: readonly BeatNote[] = Array.from({ length: 512 }, (_, numerator) => ({
    get at() {
      lookups += 1
      return { numerator, denominator: 1 }
    },
    hold: { numerator: 0, denominator: 1 },
    panel_mask: 1,
  }))
  const timing: BeatTiming = {
    schema_version: 1,
    offset_micros: 0,
    duration: null,
    tempo: [{ at: beatFromTicks(0, 1), micros_per_beat: { numerator: 500_000, denominator: 1 } }],
    grid_sections: [{ at: beatFromTicks(0, 1), rows_per_measure: 16 }],
    reference_accents: [],
  }
  const points = Array.from({ length: 64 }, (_, index) => ({
    beat: beatFromTicks(4_000 + index, 4),
    audioMicros: 500_000_000 + index * 125_000,
    kind: "grid" as const,
  }))

  const markup = renderToStaticMarkup(
    createElement(TimelineRows, {
      points,
      notes,
      timing,
      lanes: [0],
      selectedSplit: 4,
      regions: [],
      regionsReadOnly: false,
      readOnly: false,
      visibleAudioRange: { startMicros: 500_000_000, endMicros: 520_000_000 },
      runwaySize: 4_000_000,
      audioMicrosToY: (value: number) => value / 1_000,
      onOpenTempo: () => undefined,
    }),
  )

  expect(markup.match(/class="timeline__cell note-empty"/g)).toHaveLength(points.length)
  expect(lookups).toBeLessThanOrEqual(notes.length * 3 + points.length * 12)
})
