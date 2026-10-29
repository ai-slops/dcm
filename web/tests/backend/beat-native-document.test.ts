import { describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { migrateLegacyChart } from "../../server/library/legacy-beat-migration.ts"
import { nativeDocumentFor } from "../../server/native/beat-document.ts"
import { repoRoot } from "../support/paths.ts"

describe("native document boundary", () => {
  it("includes evaluation beat denominators when projecting exact native coordinates", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const source = migrateLegacyChart(demo.document.project)
    const project = {
      ...source,
      evaluation_contract: {
        ...source.evaluation_contract,
        difficulty: {
          ...source.evaluation_contract.difficulty,
          local_windows: [{ width: { numerator: 1, denominator: 7 }, maximum_load: 100 }],
        },
      },
    }

    // When
    const native = nativeDocumentFor(project)

    // Then
    expect(native.music.ticks_per_beat).toBe(28)
    expect(native.evaluation_contract.difficulty.local_windows).toEqual([
      { width_ticks: 4, maximum_load: 100 },
    ])
    expect(project.timing).toEqual(source.timing)
  })

  it("keeps automatic extent output-only when projecting a chart", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const source = migrateLegacyChart(demo.document.project)
    const project = {
      ...source,
      timing: {
        ...source.timing,
        duration: null,
        tempo: [
          ...source.timing.tempo,
          {
            at: { numerator: 10_000, denominator: 1 },
            micros_per_beat: { numerator: 400_000, denominator: 1 },
          },
        ],
        grid_sections: [
          ...source.timing.grid_sections,
          { at: { numerator: 10_000, denominator: 1 }, rows_per_measure: 508 },
        ],
        reference_accents: [
          ...source.timing.reference_accents,
          { numerator: 10_000, denominator: 1 },
        ],
      },
    }

    // When
    const native = nativeDocumentFor(project)

    // Then
    expect(native.music.duration_ticks).toBeGreaterThan(0)
    expect(native.music.tempo).toHaveLength(source.timing.tempo.length)
    expect(native.music.reference_accents).toHaveLength(source.timing.reference_accents.length)
    expect(native.music.ticks_per_beat % 127).not.toBe(0)
    expect(project.timing.duration).toBeNull()
  })

  it("returns a typed capability error rather than rounding unsupported evaluation coordinates", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const source = migrateLegacyChart(demo.document.project)
    const project = {
      ...source,
      evaluation_contract: {
        ...source.evaluation_contract,
        difficulty: {
          ...source.evaluation_contract.difficulty,
          local_windows: [{ width: { numerator: 1, denominator: 4099 }, maximum_load: 100 }],
        },
      },
    }

    // When / Then
    expect(() => nativeDocumentFor(project)).toThrowError(
      expect.objectContaining({
        capability: expect.objectContaining({ code: "native_grid_unsupported" }),
      }),
    )
  })

  it("returns a typed evaluation extent capability instead of a generic schema failure", async () => {
    const demo = await loadDemo(repoRoot)
    const source = migrateLegacyChart(demo.document.project)
    const duration = source.timing.duration
    if (duration === null) throw new Error("Expected explicit fixture duration")
    const project = {
      ...source,
      evaluation_contract: {
        ...source.evaluation_contract,
        intents: [
          {
            id: "future-negative-space",
            kind: {
              kind: "negative_space" as const,
              start: { numerator: 0, denominator: 1 },
              end: {
                numerator: duration.numerator + duration.denominator,
                denominator: duration.denominator,
              },
            },
            requiredness: "required" as const,
            credit_policy: "exclusive" as const,
            threshold: 1,
            weight: 1,
          },
        ],
      },
    }

    expect(() => nativeDocumentFor(project)).toThrowError(
      expect.objectContaining({
        code: "native_evaluation_extent_unsupported",
        capability: expect.objectContaining({ field: "intents[0].negative_space.end" }),
      }),
    )
    expect(project.evaluation_contract.intents[0]?.kind.end).toEqual({
      numerator: duration.numerator + duration.denominator,
      denominator: duration.denominator,
    })
  })
})
