import { describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import {
  migrateEvaluation,
  migrateLegacyChart,
  migrateLegacyComponent,
  migrateLegacyProject,
  migrateRules,
} from "../../server/library/legacy-beat-migration.ts"
import { migrateV3ToV4 } from "../../server/library/migrate-v3-v4.ts"
import { initialState, PersistedStateV3Schema } from "../../server/library/state.ts"
import { beatFromTicks } from "../../shared/beat.ts"
import {
  GenerationProjectSchema,
  ReusableComponentSchema,
} from "../../shared/generation-projects.ts"
import { repoRoot } from "../support/paths.ts"

describe("legacy beat migration", () => {
  it("preserves every legacy chart coordinate as an exact reduced beat", async () => {
    // Given
    const demo = await loadDemo(repoRoot)

    // When
    const migrated = migrateLegacyChart(demo.document.project)

    // Then
    expect(migrated.timing.duration).toEqual(
      beatFromTicks(
        demo.document.project.music.duration_ticks,
        demo.document.project.music.ticks_per_beat,
      ),
    )
    expect(migrated.notes[0]?.at).toEqual({ numerator: 0, denominator: 1 })
    expect(migrated.timing.grid_sections).toEqual([
      {
        at: { numerator: 0, denominator: 1 },
        rows_per_measure: demo.document.project.music.ticks_per_beat * 4,
      },
    ])
    expect(migrated.chart_artist).toBeNull()
  })

  it("preserves weighted_cycle_v1 identity and rule coordinates", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const timing = demo.document.project.music
    const project = GenerationProjectSchema.parse({
      schema_version: 1,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 3,
      name: "Rules",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Double",
      timing: {
        duration_ticks: timing.duration_ticks,
        ticks_per_beat: timing.ticks_per_beat,
        offset_micros: timing.offset_micros,
        tempo: timing.tempo,
        reference_accents: timing.reference_accents,
      },
      evaluation_contract: demo.document.project.evaluation_contract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: timing.duration_ticks,
        step_ticks: 2,
        pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 1, weight: 1 }] }],
      },
      applied_components: {},
    })

    // When
    const migrated = migrateLegacyProject(project)

    // Then
    expect(migrated.generation_rules).toMatchObject({
      algorithm: "weighted_cycle_v1",
      start: { numerator: 0, denominator: 1 },
      end: beatFromTicks(timing.duration_ticks, timing.ticks_per_beat),
      step: beatFromTicks(2, timing.ticks_per_beat),
      pattern: [{ choices: [{ hold: beatFromTicks(1, timing.ticks_per_beat) }] }],
    })
  })

  it("retains an unresolved historical component as read-only instead of guessing its basis", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const component = ReusableComponentSchema.parse({
      id: "00000000-0000-4000-8000-000000000003",
      revision: 1,
      name: "Deleted source evaluation",
      kind: "evaluation",
      source_project_id: "00000000-0000-4000-8000-000000000004",
      source_project_revision: 2,
      value: demo.document.project.evaluation_contract,
    })

    // When
    const migrated = migrateLegacyComponent(component, undefined)

    // Then
    expect(migrated).toMatchObject({
      kind: "legacy_unresolved",
      original_kind: "evaluation",
      read_only_reason: "legacy_component_basis_missing",
    })
  })

  it("converts all evaluation and generator tick fields through the same beat basis", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const rules = {
      schema_version: 1 as const,
      algorithm: "weighted_cycle_v1" as const,
      start_tick: 12,
      end_tick: 96,
      step_ticks: 24,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 36, weight: 1 }] }],
    }

    // When
    const evaluation = migrateEvaluation(demo.document.project.evaluation_contract, 48)
    const generation = migrateRules(rules, 48)

    // Then
    expect(generation).toMatchObject({
      start: { numerator: 1, denominator: 4 },
      end: { numerator: 2, denominator: 1 },
      step: { numerator: 1, denominator: 2 },
      pattern: [{ choices: [{ hold: { numerator: 3, denominator: 4 } }] }],
    })
    expect(evaluation.difficulty.local_windows[0]?.width).not.toHaveProperty("width_ticks")
  })

  it("produces a StoreV4 whose canonical chart and project records contain no tick coordinates", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const legacy = initialState(demo.document)

    // When
    const migrated = migrateV3ToV4(legacy)
    const serializedAuthoring = JSON.stringify({
      document: migrated.document,
      charts: migrated.library.charts,
      projects: migrated.projects,
    })

    // Then
    expect(migrated.version).toBe(4)
    expect(serializedAuthoring).not.toMatch(/(?:ticks_per_beat|_tick|_ticks)"/)
    expect(migrated.document.project.timing.duration).toEqual(
      beatFromTicks(
        demo.document.project.music.duration_ticks,
        demo.document.project.music.ticks_per_beat,
      ),
    )
  })

  it("migrates a high-TPB chart with its exact uniform legacy grid", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const project = {
      ...demo.document.project,
      music: {
        ...demo.document.project.music,
        duration_ticks: 4_096,
        ticks_per_beat: 4_096,
        tempo: [
          {
            start_tick: 0,
            micros_per_beat: { numerator: 500_000, denominator: 1 },
          },
        ],
        reference_accents: [2_048],
      },
      chart: {
        ticks_per_beat: 4_096,
        span_ticks: 4_096,
        notes: [{ tick: 2_048, hold_ticks: 0, panel_mask: 1 }],
      },
      evaluation_contract: {
        ...demo.document.project.evaluation_contract,
        difficulty: {
          ...demo.document.project.evaluation_contract.difficulty,
          local_windows: [],
        },
        intents: [],
      },
    }

    // When
    const migrated = migrateLegacyChart(project)

    // Then
    expect(migrated.notes[0]?.at).toEqual({ numerator: 1, denominator: 2 })
    expect(migrated.timing.grid_sections[0]?.rows_per_measure).toBe(16_384)
  })

  it("uses the generated chart TPB when the referenced project revision no longer exists", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const legacy = initialState(demo.document)
    const chart = legacy.library.charts[0]
    if (chart === undefined) throw new Error("Expected initial chart")
    const projectId = "00000000-0000-4000-8000-000000000010"
    const currentProject = GenerationProjectSchema.parse({
      schema_version: 1,
      id: projectId,
      revision: 2,
      name: "Edited grid",
      song_id: chart.song_id,
      mode: "Double",
      timing: {
        duration_ticks: 64,
        ticks_per_beat: 8,
        offset_micros: 0,
        tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        reference_accents: [],
      },
      evaluation_contract: {
        ...demo.document.project.evaluation_contract,
        difficulty: {
          ...demo.document.project.evaluation_contract.difficulty,
          local_windows: [],
        },
        intents: [],
      },
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: 64,
        step_ticks: 8,
        pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
      },
      applied_components: {},
    })
    const state = PersistedStateV3Schema.parse({
      ...legacy,
      projects: { ...legacy.projects, records: [currentProject] },
      library: {
        ...legacy.library,
        charts: legacy.library.charts.map((candidate) =>
          candidate.id === chart.id
            ? {
                ...candidate,
                generated_from: {
                  project_id: currentProject.id,
                  project_revision: 1,
                  seed: "0".repeat(64),
                  automatic_regions: [
                    {
                      id: "00000000-0000-4000-8000-000000000011",
                      name: "Historical region",
                      start_tick: 4,
                      end_tick: 8,
                    },
                  ],
                },
              }
            : candidate,
        ),
      },
    })

    // When
    const migrated = migrateV3ToV4(state)

    // Then
    expect(migrated.library.charts[0]?.generated_from?.automatic_regions[0]).toMatchObject({
      start: { numerator: 1, denominator: 1 },
      end: { numerator: 2, denominator: 1 },
    })
  })

  it("preserves a legacy archive timing grid at four rows per source tick", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const legacy = initialState(demo.document)
    const archiveId = "00000000-0000-4000-8000-000000000020"
    const state = PersistedStateV3Schema.parse({
      ...legacy,
      library: {
        ...legacy.library,
        archives: [
          {
            id: archiveId,
            name: "legacy.zip",
            sha256: "1".repeat(64),
            byte_length: 1,
            chart_names: ["chart.ucs"],
            audio_names: ["music.wav"],
          },
        ],
        songs: legacy.library.songs.map((song) => ({
          ...song,
          archive_id: archiveId,
          archive_source: {
            chart_name: "chart.ucs",
            audio_name: "music.wav",
            mode: "Double",
            timing: {
              duration_ticks: 4_096,
              ticks_per_beat: 4_096,
              offset_micros: 0,
              tempo: [
                {
                  start_tick: 0,
                  micros_per_beat: { numerator: 500_000, denominator: 1 },
                },
              ],
              reference_accents: [],
            },
          },
        })),
      },
    })

    // When
    const migrated = migrateV3ToV4(state)

    // Then
    expect(migrated.library.songs[0]?.archive_source?.timing.grid_sections[0]).toEqual({
      at: { numerator: 0, denominator: 1 },
      rows_per_measure: 16_384,
    })
  })
})
