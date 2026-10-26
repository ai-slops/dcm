import { expect, it } from "vitest"

import type { NativeChart } from "../shared/index.ts"
import { QuantizationConflictError, quantizedPlacementTick } from "../src/domain/edit-snap.ts"

it("does not replace an existing hold when a new empty-cell placement snaps onto it", () => {
  const chart: NativeChart = {
    ticks_per_beat: 4,
    span_ticks: 32,
    notes: [{ tick: 0, panel_mask: 1, hold_ticks: 6 }],
  }
  expect(() => quantizedPlacementTick(chart, { tick: 7, panel: 0 }, 8)).toThrow(
    QuantizationConflictError,
  )
  expect(chart.notes).toEqual([{ tick: 0, panel_mask: 1, hold_ticks: 6 }])
})

it("allows a future placement to snap into an empty lane without moving other notes", () => {
  const chart: NativeChart = {
    ticks_per_beat: 4,
    span_ticks: 32,
    notes: [{ tick: 0, panel_mask: 1, hold_ticks: 6 }],
  }
  expect(quantizedPlacementTick(chart, { tick: 7, panel: 1 }, 8)).toBe(0)
  expect(chart.notes).toEqual([{ tick: 0, panel_mask: 1, hold_ticks: 6 }])
})
