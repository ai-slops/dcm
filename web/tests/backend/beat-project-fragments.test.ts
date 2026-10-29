import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { StudioStore } from "../../server/store.ts"
import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { repoRoot } from "../support/paths.ts"
import { projectService } from "./beat-project-workflow-support.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("beat-native project fragments", () => {
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
})
