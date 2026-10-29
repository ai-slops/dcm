import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { ProjectService } from "../../server/projects/service.ts"
import { StudioStore } from "../../server/store.ts"
import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("extracts note fragments over a half-open beat range", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-fragment-half-open-"))
  roots.push(root)
  const demo = await loadDemo(repoRoot)
  const store = await StudioStore.open(root, demo.document, demo.audio)
  const service = new ProjectService(store, {
    generate: () => Promise.reject(new TypeError("generation not expected")),
  })
  const song = store.library().songs[0]
  const chart = store.library().charts[0]
  if (song === undefined || chart === undefined) throw new TypeError("Expected initial library")
  const source = store.document().project
  const created = await service.command(
    ProjectCommandSchema.parse({
      type: "create_project",
      song_id: song.id,
      mode: source.mode,
      name: "Half-open fragment",
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
          {
            at: { numerator: 1, denominator: 1 },
            hold: { numerator: 1, denominator: 1 },
            panel_mask: 2,
          },
          {
            at: { numerator: 2, denominator: 1 },
            hold: { numerator: 0, denominator: 1 },
            panel_mask: 4,
          },
        ],
        regions: [],
      },
    }),
  )
  const project = created.project
  if (project === undefined) throw new TypeError("Expected created project")

  // When
  const published = await service.command(
    ProjectCommandSchema.parse({
      type: "publish_component",
      project_id: project.id,
      base_revision: project.revision,
      kind: "note_fragment",
      name: "Two-beat phrase",
      start: { numerator: 0, denominator: 1 },
      end: { numerator: 2, denominator: 1 },
    }),
  )

  // Then
  expect(published.component).toMatchObject({
    kind: "note_fragment",
    value: {
      notes: [
        { at: { numerator: 0, denominator: 1 }, panel_mask: 1 },
        {
          at: { numerator: 1, denominator: 1 },
          hold: { numerator: 1, denominator: 1 },
          panel_mask: 2,
        },
      ],
    },
  })
})
