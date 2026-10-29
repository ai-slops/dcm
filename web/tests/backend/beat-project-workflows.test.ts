import { mkdtemp, readFile, rm } from "node:fs/promises"
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

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("beat-native project workflows", () => {
  it("requires an explicit saved or archive base and preserves project CAS", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-project-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const service = projectService(store)
    const song = store.library().songs[0]
    const chart = store.library().charts[0]
    if (song === undefined || chart === undefined) throw new Error("Expected initial library")
    const source = store.document().project

    // When
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Explicit base",
        chart_artist: "Backend Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing: source.timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: weightedRules(source.timing.duration),
      }),
    )
    const project = created.project
    if (project === undefined) throw new Error("Expected created project")
    const stale = service.command(
      ProjectCommandSchema.parse({
        type: "write_project",
        project_id: project.id,
        base_revision: project.revision + 1,
        name: project.name,
        chart_artist: project.chart_artist,
        timing: project.timing,
        evaluation_contract: project.evaluation_contract,
        generation_rules: project.generation_rules,
      }),
    )

    // Then
    expect(project).toMatchObject({ schema_version: 2, chart_artist: "Backend Author" })
    await expect(stale).rejects.toMatchObject({ code: "project_revision_conflict" })
    const persisted = JSON.parse(await readFile(join(root, "document.json"), "utf8"))
    expect(persisted).toMatchObject({
      version: 4,
      projects: { records: [{ schema_version: 2, chart_artist: "Backend Author" }] },
    })
    expect(JSON.stringify(persisted.projects.records)).not.toMatch(
      /(?:ticks_per_beat|_tick|_ticks)"/,
    )
  })

  it("allows automatic duration while preserving every other selected-base timing field", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-create-auto-duration-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const service = projectService(store)
    const song = store.library().songs[0]
    const chart = store.library().charts[0]
    if (song === undefined || chart === undefined) throw new Error("Expected initial library")
    const source = store.document().project
    const timing = { ...source.timing, duration: null }

    // When
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Automatic duration",
        chart_artist: "Backend Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: weightedRules(source.timing.duration),
      }),
    )
    const mismatched = service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Wrong offset",
        chart_artist: "Backend Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing: { ...timing, offset_micros: timing.offset_micros + 1 },
        evaluation_contract: source.evaluation_contract,
        generation_rules: weightedRules(source.timing.duration),
      }),
    )

    // Then
    expect(created.project?.timing.duration).toBeNull()
    await expect(mismatched).rejects.toMatchObject({ code: "base_timing_mismatch" })
  })

  it("uses a selected chart as timing provenance without inheriting its mode", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-cross-mode-base-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const projects = projectService(store)
    const library = new LibraryService(store)
    const song = store.library().songs[0]
    const doubleChart = store.library().charts[0]
    if (song === undefined || doubleChart === undefined) throw new Error("Expected initial library")
    const doubleSource = store.document().project

    // When
    const singleProject = await projects.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: "Single",
        name: "Single from Double timing",
        chart_artist: "Cross Mode Author",
        base_ucs_ref: { source: "saved_chart", chart_id: doubleChart.id },
        timing: doubleSource.timing,
        evaluation_contract: doubleSource.evaluation_contract,
        generation_rules: weightedRules(doubleSource.timing.duration),
      }),
    )
    const singleChartMutation = await library.command(
      LibraryCommandSchema.parse({
        type: "new_chart",
        library_revision: store.library().revision,
        base_revision: store.document().revision,
        song_id: song.id,
        name: "Single timing source",
        mode: "Single",
      }),
    )
    const singleChart = singleChartMutation.library.charts.find(
      (chart) => chart.id === singleChartMutation.library.active_chart_id,
    )
    if (singleChart === undefined) throw new Error("Expected Single chart")
    const singleSource = store.document().project
    const doubleProject = await projects.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: "Double",
        name: "Double from Single timing",
        chart_artist: "Cross Mode Author",
        base_ucs_ref: { source: "saved_chart", chart_id: singleChart.id },
        timing: singleSource.timing,
        evaluation_contract: singleSource.evaluation_contract,
        generation_rules: weightedRules(singleSource.timing.duration),
      }),
    )

    // Then
    expect(singleProject.project?.mode).toBe("Single")
    expect(doubleProject.project?.mode).toBe("Double")
  })

  it("publishes relative note fragments and applies them atomically", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-fragment-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const service = projectService(store)
    const song = store.library().songs[0]
    const chart = store.library().charts[0]
    if (song === undefined || chart === undefined) throw new Error("Expected initial library")
    const source = store.document().project
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: source.mode,
        name: "Fragments",
        chart_artist: "Fragment Author",
        base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
        timing: source.timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: {
          schema_version: 2,
          algorithm: "hybrid_regions_v1",
          fixed_notes: [
            {
              at: { numerator: 0, denominator: 1 },
              hold: { numerator: 0, denominator: 1 },
              panel_mask: 1,
            },
          ],
          regions: [],
        },
      }),
    )
    const project = created.project
    if (project === undefined) throw new Error("Expected created project")
    const published = await service.command(
      ProjectCommandSchema.parse({
        type: "publish_component",
        project_id: project.id,
        base_revision: project.revision,
        kind: "note_fragment",
        name: "Opening tap",
        start: { numerator: 0, denominator: 1 },
        end: { numerator: 1, denominator: 1 },
      }),
    )
    const component = published.component
    if (component === undefined) throw new Error("Expected fragment component")
    const collision = service.command(
      ProjectCommandSchema.parse({
        type: "apply_component",
        project_id: project.id,
        base_revision: project.revision,
        component_id: component.id,
        at: { numerator: 0, denominator: 1 },
      }),
    )
    await expect(collision).rejects.toBeInstanceOf(Error)
    expect(service.read(project.id).generation_rules).toMatchObject({
      fixed_notes: [{ panel_mask: 1 }],
    })

    // When
    const applied = await service.command(
      ProjectCommandSchema.parse({
        type: "apply_component",
        project_id: project.id,
        base_revision: project.revision,
        component_id: component.id,
        at: { numerator: 2, denominator: 1 },
      }),
    )

    // Then
    expect(component).toMatchObject({
      kind: "note_fragment",
      value: {
        span: { numerator: 1, denominator: 1 },
        notes: [{ at: { numerator: 0, denominator: 1 }, panel_mask: 1 }],
      },
    })
    expect(applied.project?.generation_rules).toMatchObject({
      fixed_notes: [
        { at: { numerator: 0, denominator: 1 }, panel_mask: 1 },
        { at: { numerator: 2, denominator: 1 }, panel_mask: 1 },
      ],
    })
  })

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

  it("stores automatic duration explicitly as null without deriving a persisted tick span", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-beat-auto-duration-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const source = store.document()

    // When
    const saved = await store.save(source.revision, {
      ...source.project,
      timing: { ...source.project.timing, duration: null },
    })

    // Then
    expect(saved.project.timing.duration).toBeNull()
    const persisted = JSON.parse(await readFile(join(root, "document.json"), "utf8"))
    expect(persisted.document.project.timing.duration).toBeNull()
    expect(JSON.stringify(persisted.document.project)).not.toMatch(/(?:span_ticks|duration_ticks)"/)
  })
})

function projectService(store: StudioStore): ProjectService {
  return new ProjectService(store, {
    generate: () => Promise.reject(new Error("generation not expected")),
  })
}

function weightedRules(
  duration: { readonly numerator: number; readonly denominator: number } | null,
) {
  if (duration === null) throw new Error("Expected explicit migrated duration")
  return {
    schema_version: 1 as const,
    algorithm: "weighted_cycle_v1" as const,
    start: { numerator: 0, denominator: 1 },
    end: duration,
    step: { numerator: 2, denominator: 1 },
    pattern: [
      {
        choices: [
          {
            panel_mask: 1,
            hold: { numerator: 0, denominator: 1 },
            weight: 1,
          },
        ],
      },
    ],
  }
}
