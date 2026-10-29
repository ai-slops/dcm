import { expect, it } from "vitest"
import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { BeatChartCoreSchema } from "../shared/beat.ts"
import { repoRoot } from "./support/paths.ts"

it("rejects unmerged masks at the same beat and hold before persistence or UCS export", () => {
  const zero = { numerator: 0, denominator: 1 }
  const result = BeatChartCoreSchema.safeParse({
    mode: "Single",
    timing: {
      schema_version: 1,
      duration: { numerator: 2, denominator: 1 },
      offset_micros: 0,
      tempo: [{ at: zero, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      grid_sections: [{ at: zero, rows_per_measure: 4 }],
      reference_accents: [],
    },
    notes: [
      { at: zero, hold: zero, panel_mask: 1 },
      { at: zero, hold: zero, panel_mask: 2 },
    ],
  })

  expect(result.success).toBe(false)
})

it("merges legacy disjoint masks losslessly when migrating to the canonical beat source", async () => {
  const demo = await loadDemo(repoRoot)
  const migrated = migrateLegacyChart({
    ...demo.document.project,
    chart: {
      ...demo.document.project.chart,
      notes: [
        { tick: 0, hold_ticks: 0, panel_mask: 1 },
        { tick: 0, hold_ticks: 0, panel_mask: 2 },
      ],
    },
  })

  expect(migrated.notes).toEqual([
    { at: { numerator: 0, denominator: 1 }, hold: { numerator: 0, denominator: 1 }, panel_mask: 3 },
  ])
})
