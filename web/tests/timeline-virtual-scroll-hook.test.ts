import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import type { BeatTiming } from "../shared/beat.ts"
import {
  type TimelineVirtualScroll,
  useTimelineVirtualScroll,
} from "../src/ui/useTimelineVirtualScroll.ts"

const timing: BeatTiming = {
  schema_version: 1,
  offset_micros: 100_000,
  tempo: [
    {
      at: { numerator: 0, denominator: 1 },
      micros_per_beat: { numerator: 500_000, denominator: 1 },
    },
  ],
  grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 12 }],
  duration: null,
  reference_accents: [],
}

it("publishes audio-time geometry without deriving rows from imported grid hints", () => {
  let captured: TimelineVirtualScroll | undefined
  function Driver() {
    captured = useTimelineVirtualScroll({ timing, lookaheadSeconds: 4 })
    return createElement("div", { ref: captured.scrollerRef })
  }

  renderToStaticMarkup(createElement(Driver))

  if (captured === undefined) throw new RangeError("Timeline hook did not render")
  expect(captured.runwaySize).toBe(4_000_000)
  expect(captured.audioMicrosToY(timing.offset_micros)).toBe(2_000_000)
  expect(captured.audioMicrosAtClientY(0)).toBe(timing.offset_micros)
  expect(captured.visibleAudioRange.endMicros - timing.offset_micros).toBe(4_000_000)
})
