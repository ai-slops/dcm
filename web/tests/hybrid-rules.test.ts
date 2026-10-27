import { expect, it } from "vitest"

import { GenerationRulesSchema } from "../shared/generation-rules.ts"
import { ucsCellConflict } from "../shared/ucs-cells.ts"

const region = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Verse",
  rules: {
    start_tick: 8,
    end_tick: 24,
    step_ticks: 4,
    pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
  },
}

it("rejects a hold tail sharing a UCS cell with another note", () => {
  expect(
    ucsCellConflict([
      { tick: 0, panel_mask: 1, hold_ticks: 4 },
      { tick: 4, panel_mask: 1, hold_ticks: 0 },
    ]),
  ).toMatchObject({ panel: 0, tick: 4 })
})

it("allows separate lanes at one tick without conflating them", () => {
  expect(
    ucsCellConflict([
      { tick: 0, panel_mask: 1, hold_ticks: 4 },
      { tick: 4, panel_mask: 2, hold_ticks: 0 },
    ]),
  ).toBeNull()
})

it("preserves fixed notes outside named automatic ranges", () => {
  const value = GenerationRulesSchema.parse({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [{ tick: 0, panel_mask: 1, hold_ticks: 0 }],
    regions: [region],
  })
  expect(value.schema_version).toBe(2)
})

it("rejects fixed cells including hold tails inside automatic ranges", () => {
  expect(
    GenerationRulesSchema.safeParse({
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [{ tick: 4, panel_mask: 2, hold_ticks: 4 }],
      regions: [region],
    }).success,
  ).toBe(false)
})

it("rejects overlapping named ranges rather than silently overriding one", () => {
  expect(
    GenerationRulesSchema.safeParse({
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [
        region,
        {
          ...region,
          id: "00000000-0000-4000-8000-000000000002",
          rules: { ...region.rules, start_tick: 16 },
        },
      ],
    }).success,
  ).toBe(false)
})

it("retains the existing weighted-cycle wire format", () => {
  expect(
    GenerationRulesSchema.safeParse({
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      ...region.rules,
    }).success,
  ).toBe(true)
})
