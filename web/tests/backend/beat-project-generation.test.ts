import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { LibraryService } from "../../server/library/service.ts"
import { ProjectService } from "../../server/projects/service.ts"
import { StudioStore } from "../../server/store.ts"
import { LibraryCommandSchema } from "../../shared/library-commands.ts"
import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { generationMutation } from "../support/agent-project-fixtures.ts"
import { repoRoot } from "../support/paths.ts"
import { weightedRules } from "./beat-project-workflow-support.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("beat-native project generation", () => {
  it("persists generated results as beat charts instead of native tick shadows", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-generation-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const fixture = generationMutation().generation
    if (fixture === undefined) throw new Error("Expected generation fixture")
    const service = new ProjectService(store, {
      generate: async (nativeProject) => ({
        schema_version: 1,
        mode: nativeProject.mode,
        chart: {
          ticks_per_beat: nativeProject.timing.ticks_per_beat,
          span_ticks: nativeProject.timing.duration_ticks,
          notes: [{ tick: 0, hold_ticks: 0, panel_mask: 1 }],
        },
        assessment: fixture.assessment,
        ucs_validation: fixture.ucs_validation,
        request_sha256: fixture.request_sha256,
        certification: fixture.certification,
      }),
    })
    const song = store.library().songs[0]
    const chart = store.library().charts[0]
    if (song === undefined || chart === undefined) throw new Error("Expected initial library")
    const source = store.document().project
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Generate beats",
        chart_artist: "Generator Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing: source.timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: weightedRules(source.timing.duration),
      }),
    )
    const project = created.project
    if (project === undefined) throw new Error("Expected created project")

    // When
    const generated = await service.command(
      ProjectCommandSchema.parse({
        type: "generate_project",
        project_id: project.id,
        base_revision: project.revision,
        name: "Generated beats",
        seed: "0".repeat(64),
      }),
    )
    const chartId = generated.generation?.chart_id
    if (chartId === undefined) throw new Error("Expected generated chart")
    const stored = store.chartDocument(chartId)

    // Then
    expect(stored.project).toMatchObject({
      chart_artist: "Generator Author",
      notes: [{ at: { numerator: 0, denominator: 1 }, panel_mask: 1 }],
    })
    expect(JSON.stringify(stored.project)).not.toMatch(/(?:ticks_per_beat|_tick|_ticks)"/)
  })

  it("uses song metadata read inside the generation commit transaction", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-generation-rename-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const library = new LibraryService(store)
    const fixture = generationMutation().generation
    if (fixture === undefined) throw new Error("Expected generation fixture")
    const song = store.library().songs[0]
    const chart = store.library().charts[0]
    if (song === undefined || chart === undefined) throw new Error("Expected initial library")
    const service = new ProjectService(store, {
      generate: async (nativeProject) => {
        await library.command(
          LibraryCommandSchema.parse({
            type: "rename_song",
            library_revision: store.library().revision,
            song_id: song.id,
            title: "Renamed during generation",
            artist: "Current Artist",
          }),
        )
        return {
          schema_version: 1,
          mode: nativeProject.mode,
          chart: {
            ticks_per_beat: nativeProject.timing.ticks_per_beat,
            span_ticks: nativeProject.timing.duration_ticks,
            notes: [],
          },
          assessment: fixture.assessment,
          ucs_validation: fixture.ucs_validation,
          request_sha256: fixture.request_sha256,
          certification: fixture.certification,
        }
      },
    })
    const source = store.document().project
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Concurrent metadata",
        chart_artist: "Generator Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing: source.timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: weightedRules(source.timing.duration),
      }),
    )
    const project = created.project
    if (project === undefined) throw new Error("Expected created project")

    // When
    const generated = await service.command(
      ProjectCommandSchema.parse({
        type: "generate_project",
        project_id: project.id,
        base_revision: project.revision,
        name: "Generated after rename",
        seed: "0".repeat(64),
      }),
    )
    const generatedChartId = generated.generation?.chart_id
    if (generatedChartId === undefined) throw new Error("Expected generated chart")

    // Then
    expect(store.chartDocument(generatedChartId).project).toMatchObject({
      title: "Renamed during generation",
      artist: "Current Artist",
    })
  })
})
