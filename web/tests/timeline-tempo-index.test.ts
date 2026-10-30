import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { type BeatTiming, beatFromTicks } from "../shared/beat.ts"
import { TimelineRows } from "../src/ui/TimelineRows.tsx"

it("bounds tempo marker reads when rendering the maximum marker count", () => {
  // Given the maximum valid tempo map and visible points near its tail
  let markerReads = 0
  const markerCount = 4_096
  const timing: BeatTiming = {
    schema_version: 1,
    offset_micros: 0,
    duration: null,
    tempo: Array.from({ length: markerCount }, (_, numerator) => ({
      get at() {
        markerReads += 1
        return beatFromTicks(numerator, 1)
      },
      micros_per_beat: { numerator: 500_000, denominator: 1 },
    })),
    grid_sections: [{ at: beatFromTicks(0, 1), rows_per_measure: 16 }],
    reference_accents: [],
  }
  const points = Array.from({ length: 32 }, (_, index) => ({
    beat: beatFromTicks(markerCount - 32 + index, 1),
    audioMicros: (markerCount - 32 + index) * 500_000,
    kind: "grid" as const,
  }))

  // When the timing gutter renders
  renderToStaticMarkup(
    createElement(TimelineRows, {
      points,
      notes: [],
      timing,
      lanes: [0],
      selectedSplit: 4,
      regions: [],
      regionsReadOnly: false,
      readOnly: false,
      visibleAudioRange: { startMicros: 0, endMicros: 3_000_000_000 },
      runwaySize: 4_000_000,
      audioMicrosToY: (value: number) => value / 1_000,
      onOpenTempo: () => undefined,
    }),
  )

  // Then marker access stays linear in the marker count rather than points times markers
  expect(markerReads).toBeLessThanOrEqual(markerCount * 4 + points.length * 16)
})
