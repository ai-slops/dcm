import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { BeatAutomaticRegionViewSchema, StudioProjectV1Schema } from "../shared/index.ts"
import { Timeline } from "../src/ui/Timeline.tsx"
import { TimelineRows } from "../src/ui/TimelineRows.tsx"
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
      onTimingChange: () => undefined,
    }),
  )

  // Then the structured note alternative preserves every exact fraction
  expect(markup).toContain("timeline__note-glyph")
  expect(markup).toContain("Note spacing")
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
      onTimingChange: () => undefined,
    }),
  )

  // Then the editor exposes one five-panel pad
  expect(markup).toContain("Single · 5 lanes · left pad")
  expect(markup).toContain("L DR")
  expect(markup).not.toContain("R DR")
  expect(markup).toContain("Split")
  expect(markup).toContain("Lookahead")
  expect(markup).toContain("Audio offset (ms)")
  expect(markup).not.toContain("Previous measure")
  expect(markup).not.toContain("Keyboard hold rows")
  expect(markup).not.toContain("Follow audio")
  expect(markup).not.toContain('class="timeline__scroll-cue"')
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
      onTimingChange: () => undefined,
    }),
  )

  // Then region protection, tempo, and exact beat semantics share the same row DOM
  expect(markup).toContain("Chorus cycle · automatic")
  expect(markup).toContain('aria-disabled="true"')
  expect(markup).toContain("120 BPM")
  expect(markup).toContain("Lane L DL, beat 0/1, empty, automatic region Chorus cycle")
})

it("renders one combined beat and tempo gutter with an automatic end line", async () => {
  // Given a chart whose final occupied beat is inferred from its notes
  const project = await beatDemo()

  // When the shared editor timeline renders
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      notes: [{ at: beat(1), hold: beat(1), panel_mask: 1 }],
      timing: { ...project.timing, duration: null },
      mode: project.mode,
      playback: new AudioPlaybackController(project),
      onToggleTap: () => undefined,
      onPlaceHold: () => undefined,
      onTimingChange: () => undefined,
    }),
  )

  // Then timing is one direct-action gutter and duration is controlled by the line
  expect(markup).toContain("Beat / Tempo")
  expect(markup).toContain("Set explicit end at beat")
  expect(markup).not.toContain("Explicit duration")
})

it("keeps a hold visible when its head is above the audio viewport", async () => {
  // Given a hold whose head is earlier than every visible grid point
  const project = await beatDemo()
  const note = { at: beat(0), hold: beat(8), panel_mask: 1 }

  // When rows render a viewport intersecting only the hold body and tail
  const markup = renderToStaticMarkup(
    createElement(TimelineRows, {
      points: [{ beat: beat(4), audioMicros: 2_100_000, kind: "grid" }],
      notes: [note],
      timing: project.timing,
      lanes: [0],
      selectedSplit: 4,
      regions: [],
      regionsReadOnly: false,
      readOnly: false,
      visibleAudioRange: { startMicros: 2_000_000, endMicros: 4_200_000 },
      runwaySize: 4_000_000,
      audioMicrosToY: (audioMicros: number) => audioMicros / 1_000,
      onOpenTempo: () => undefined,
    }),
  )

  // Then the clipped overlay retains the original authored identity without a duplicate empty cell
  expect(markup).toContain("exact note at beat 0, hold tail 8")
  expect(markup).toContain('data-tail-numerator="8"')
  expect(markup).not.toContain("Lane L DL, beat 4/1, empty")
  expect(markup).toContain("inset-block-start:2000px;block-size:1700px")
})

it("renders occupied exact notes without interactive empty cells beneath them", async () => {
  // Given an exact tap on a visible selected-split row
  const project = await beatDemo()

  // When the row and exact overlay render together
  const markup = renderToStaticMarkup(
    createElement(TimelineRows, {
      points: [{ beat: beat(1), audioMicros: 500_000, kind: "grid" }],
      notes: [{ at: beat(1), hold: beat(0), panel_mask: 1 }],
      timing: project.timing,
      lanes: [0],
      selectedSplit: 4,
      regions: [],
      regionsReadOnly: false,
      readOnly: false,
      visibleAudioRange: { startMicros: 0, endMicros: 1_000_000 },
      runwaySize: 4_000_000,
      audioMicrosToY: (audioMicros: number) => audioMicros / 1_000,
      onOpenTempo: () => undefined,
    }),
  )

  // Then the authored note is the lane's only interactive target at that beat
  expect(markup).toContain("exact note at beat 1")
  expect(markup).not.toContain("Lane L DL, beat 1/1, empty")
})

it("keeps the structured note list outside the rebasing scroller", async () => {
  // Given a timeline with a structured exact-note alternative
  const project = await beatDemo()

  // When the timeline shell renders
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      notes: [{ at: beat(1), hold: beat(0), panel_mask: 1 }],
      timing: project.timing,
      mode: project.mode,
      playback: new AudioPlaybackController(project),
      onToggleTap: () => undefined,
      onPlaceHold: () => undefined,
      onTimingChange: () => undefined,
    }),
  )

  // Then the scroller closes before the independently reachable note list begins
  expect(markup).toMatch(
    /class="timeline__controls"[\s\S]*?class="timeline__scroll-cue"[\s\S]*?class="timeline__scroller"[\s\S]*?<\/section><details class="note-list"/,
  )
})
