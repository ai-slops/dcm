import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { buildAgentProposal } from "../../server/agent/proposal.ts"
import { loadDemo } from "../../server/demo.ts"
import { migrateLegacyChart } from "../../server/library/legacy-beat-migration.ts"
import { LibraryService } from "../../server/library/service.ts"
import { ProjectService } from "../../server/projects/service.ts"
import { StudioStore } from "../../server/store.ts"
import { PutDocumentRequestSchema } from "../../shared/api.ts"
import { LibraryCommandSchema } from "../../shared/library-commands.ts"
import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { generationMutation } from "../support/agent-project-fixtures.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("hybrid backend boundaries", () => {
  it("persists generated origin with beat-native automatic region bounds", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-hybrid-origin-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const song = store.library().songs[0]
    const baseChart = store.library().charts[0]
    if (song === undefined || baseChart === undefined)
      throw new TypeError("Expected initial library")
    const generatedFixture = generationMutation().generation
    if (generatedFixture === undefined) throw new TypeError("Expected generation fixture")
    const {
      chart_id: _chartId,
      project_id: _projectId,
      project_revision: _projectRevision,
      seed: _seed,
      ...nativeGeneration
    } = generatedFixture
    const service = new ProjectService(store, {
      generate: async (project) => ({
        ...nativeGeneration,
        mode: project.mode,
        chart: {
          ticks_per_beat: project.timing.ticks_per_beat,
          span_ticks: project.timing.duration_ticks,
          notes: [],
        },
      }),
    })
    const source = store.document().project
    if (source.timing.duration === null) throw new TypeError("Expected explicit duration")
    const created = await service.command(
      ProjectCommandSchema.parse({
        type: "create_project",
        song_id: song.id,
        mode: "Double",
        name: "Hybrid",
        chart_artist: "Hybrid Author",
        base_ucs_ref: { source: "saved_chart", chart_id: baseChart.id },
        timing: source.timing,
        evaluation_contract: source.evaluation_contract,
        generation_rules: {
          schema_version: 2,
          algorithm: "hybrid_regions_v1",
          fixed_notes: [],
          regions: [
            {
              id: "00000000-0000-4000-8000-000000000010",
              name: "Verse",
              rules: {
                start: { numerator: 0, denominator: 1 },
                end: source.timing.duration,
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
              },
            },
          ],
        },
      }),
    )
    const project = created.project
    if (project === undefined) throw new TypeError("Expected created project")
    const generated = await service.command(
      ProjectCommandSchema.parse({
        type: "generate_project",
        project_id: project.id,
        base_revision: project.revision,
        name: "Generated",
        seed: "0".repeat(64),
      }),
    )
    const chartId = generated.generation?.chart_id
    if (chartId === undefined) throw new TypeError("Expected generated chart")

    // When
    const opened = await new LibraryService(store).command(
      LibraryCommandSchema.parse({
        type: "open_chart",
        library_revision: store.library().revision,
        base_revision: store.document().revision,
        chart_id: chartId,
      }),
    )
    const saved = await store.save(opened.document.revision, opened.document.project)
    const persisted: unknown = JSON.parse(await readFile(join(root, "document.json"), "utf8"))

    // Then
    expect(saved.origin).toEqual({
      project_id: project.id,
      project_revision: project.revision,
      seed: "0".repeat(64),
      automatic_regions: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          name: "Verse",
          start: { numerator: 0, denominator: 1 },
          end: source.timing.duration,
        },
      ],
    })
    expect(persisted).toMatchObject({ document: { origin: saved.origin } })
    const rebound = await new LibraryService(store).rebindAudio(
      song.id,
      store.library().revision,
      saved.revision,
      store.audio(),
    )
    expect(rebound.document.origin).toEqual(saved.origin)
    const replaced = await store.replace(
      rebound.document.revision,
      { ...rebound.document.project, title: "Replacement" },
      demo.audio,
    )
    expect(replaced.origin).toBeUndefined()
    expect(store.chartDocument(chartId).chart.generated_from).toBeUndefined()
  })

  it("rejects inclusive UCS hold-tail collisions at save and agent proposal boundaries", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-hybrid-collision-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const current = store.document()
    const notes = [
      {
        at: { numerator: 0, denominator: 1 },
        panel_mask: 1,
        hold: { numerator: 1, denominator: 1 },
      },
      {
        at: { numerator: 1, denominator: 1 },
        panel_mask: 1,
        hold: { numerator: 0, denominator: 1 },
      },
    ]
    const nativeChart = {
      ticks_per_beat: 4,
      span_ticks: 32,
      notes: [
        { tick: 0, panel_mask: 1, hold_ticks: 4 },
        { tick: 4, panel_mask: 1, hold_ticks: 0 },
      ],
    }

    // When / Then
    await expect(store.save(0, { ...current.project, notes })).rejects.toBeInstanceOf(Error)
    expect(() =>
      buildAgentProposal(
        store.document(),
        { chart: nativeChart, summary: "Collision" },
        crypto.randomUUID(),
      ),
    ).toThrowError(expect.objectContaining({ code: "ucs_cell_conflict" }))
  })

  it("rejects client-authored document origin on the save request boundary", async () => {
    // Given
    const demo = await loadDemo(repoRoot)

    // When
    const forged = PutDocumentRequestSchema.safeParse({
      base_revision: demo.document.revision,
      project: migrateLegacyChart(demo.document.project),
      origin: {
        project_id: "00000000-0000-4000-8000-000000000001",
        project_revision: 0,
        automatic_regions: [],
      },
    })

    // Then
    expect(forged.success).toBe(false)
  })
})
