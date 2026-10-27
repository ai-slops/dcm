import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { GenerationProjectSchema } from "../shared/generation-projects.ts"
import { LibrarySongSchema } from "../shared/library.ts"
import { ProjectGridEditor } from "../src/ui/ProjectGridEditor.tsx"
import { repoRoot } from "./support/paths.ts"

async function fixture() {
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audioDigest, ...timing } = demo.document.project.music
  const project = GenerationProjectSchema.parse({
    schema_version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    name: "Visual rules",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Double",
    applied_components: {},
    timing,
    evaluation_contract: demo.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [{ tick: 0, panel_mask: 1, hold_ticks: 0 }],
      regions: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Verse",
          rules: {
            start_tick: 8,
            end_tick: 24,
            step_ticks: 4,
            pattern: [{ choices: [{ panel_mask: 2, hold_ticks: 0, weight: 1 }] }],
          },
        },
      ],
    },
  })
  const song = LibrarySongSchema.parse({
    id: project.song_id,
    title: "Stored song",
    artist: "Stored artist",
    audio: { format: "wav", byte_length: 44, sha256: "0".repeat(64) },
  })
  return { project, song }
}

it("renders fixed-note authoring and named automatic region controls", async () => {
  // Given
  const { project, song } = await fixture()

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: false,
      dirty: true,
      generation: null,
      project,
      song,
      timingTemplate: project.timing,
      onGenerate: () => undefined,
      onProject: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Unsaved project draft")
  expect(markup).toContain("Verse · automatic")
  expect(markup).toContain("Scroll sideways inside the grid to reach all 10 lanes")
  expect(markup).toContain("Clear verse")
  expect(markup).toContain("Add tail")
  expect(markup).toContain("Save project rules before generating")
})

it("requires explicit confirmation before converting V1 rules", async () => {
  // Given
  const { project, song } = await fixture()
  const legacy = GenerationProjectSchema.parse({
    ...project,
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: project.timing.duration_ticks,
      step_ticks: project.timing.ticks_per_beat,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
  })

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: false,
      dirty: false,
      generation: null,
      project: legacy,
      song,
      timingTemplate: legacy.timing,
      onGenerate: () => undefined,
      onProject: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Visual grid conversion required")
  expect(markup).toContain("Convert to visual hybrid rules")
  expect(markup).toContain("can resample generated output")
  expect(markup).not.toContain("Confirm conversion")
})

it("locks region timing and generation fields during a mutation", async () => {
  // Given
  const { project, song } = await fixture()

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectGridEditor, {
      busy: true,
      dirty: true,
      generation: null,
      project,
      song,
      timingTemplate: project.timing,
      onGenerate: () => undefined,
      onProject: () => undefined,
      onSave: () => undefined,
    }),
  )

  // Then
  expect(markup).toMatch(/<input disabled="" required="" id="[^"]+" value="Verse"\/>/)
  expect(markup).toContain('disabled="" required="" value="Generated chart"')
  expect(markup).toMatch(
    /<input class="mono" disabled="" inputMode="numeric" required="" id="[^"]+"[^>]*value=""\/>/,
  )
})
