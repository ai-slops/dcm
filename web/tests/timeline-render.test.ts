import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { BeatAutomaticRegionViewSchema, StudioProjectV1Schema } from "../shared/index.ts"
import { Timeline } from "../src/ui/Timeline.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

const beat = (numerator: number, denominator = 1) => ({ numerator, denominator })

async function beatDemo() {
  const demo = await loadDemo(repoRoot)
  const legacy = StudioProjectV1Schema.parse(demo.document.project)
  return migrateLegacyChart({ ...legacy, chart: { ...legacy.chart, notes: [] } })
}

it("renders exact off-section notes and complete holds without moving imported data", async () => {
  // Given valid notes with exact beat fractions on different section rows
  const demo = await beatDemo()
  const project = {
    ...demo,
    notes: [
      { at: beat(1, 3), hold: beat(0), panel_mask: 1 },
      { at: beat(3, 2), hold: beat(1, 2), panel_mask: 2 },
    ],
  }

  // When the beat-native timeline renders the document
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      notes: project.notes,
      timing: project.timing,
      mode: project.mode,
      playback: new AudioPlaybackController(project),
      onToggleTap: () => undefined,
      onPlaceHold: () => undefined,
      onRowsPerMeasureChange: () => undefined,
    }),
  )

  // Then the structured note alternative preserves every exact fraction
  expect(markup).toContain("Beat 1/3, mask 1, hold 0")
  expect(markup).toContain("Beat 3/2, mask 2, hold 1/2")
})

it("renders only five playable lanes for a Single chart", async () => {
  // Given a beat chart whose mode is Single
  const demo = await beatDemo()
  const project = { ...demo, mode: "Single" as const }

  // When the timeline is rendered
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      notes: project.notes,
      timing: project.timing,
      mode: project.mode,
      playback: new AudioPlaybackController(project),
      onToggleTap: () => undefined,
      onPlaceHold: () => undefined,
      onRowsPerMeasureChange: () => undefined,
    }),
  )

  // Then the editor exposes one five-panel pad
  expect(markup).toContain("Single · 5 lanes · left pad")
  expect(markup).toContain("L DR")
  expect(markup).not.toContain("R DR")
})

it("renders named automatic regions as protected beat cells with synchronized tempo gutter", async () => {
  // Given a named automatic region intersecting the first virtual window
  const project = await beatDemo()
  const region = BeatAutomaticRegionViewSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Chorus cycle",
    start: beat(0),
    end: beat(2),
  })

  // When the project timeline renders that region in read-only mode
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      notes: project.notes,
      timing: project.timing,
      mode: project.mode,
      playback: new AudioPlaybackController(project),
      automaticRegions: [region],
      regionsReadOnly: true,
      onToggleTap: () => undefined,
      onPlaceHold: () => undefined,
      onRowsPerMeasureChange: () => undefined,
    }),
  )

  // Then region protection, tempo, and exact beat semantics share the same row DOM
  expect(markup).toContain("Chorus cycle · automatic")
  expect(markup).toContain('aria-disabled="true"')
  expect(markup).toContain("120 BPM")
  expect(markup).toContain("Lane L DL, beat 0/1, empty, automatic region Chorus cycle")
})
