import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { PrimitiveStateHarness } from "../src/ui/PrimitiveShowcase.tsx"
import { parseLookaheadDraft, ScrollingChartPreview } from "../src/ui/ScrollingChartPreview.tsx"
import { PlayfieldPads } from "../src/ui/StudioPanels.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("keeps explicit pad-side identity in the scrolling preview", async () => {
  // Given the reusable preview with a native ten-lane chart
  const demo = await loadDemo(repoRoot)

  // When its default stopped state renders
  const markup = renderToStaticMarkup(
    createElement(ScrollingChartPreview, {
      chart: demo.document.project.chart,
      music: demo.document.project.music,
      playback: new AudioPlaybackController(demo.document.project),
      selectedTick: 0,
    }),
  )

  // Then both pad sides and the lookahead control remain explicitly labelled
  expect(markup).toContain("Left pad · L")
  expect(markup).toContain("Right pad · R")
  expect(markup).toContain('aria-label="Preview lookahead range"')
  expect(markup).toContain('aria-label="Exact preview lookahead seconds"')
  expect(markup).toContain('type="range"')
  expect(markup).toContain('min="0.1"')
  expect(markup).toContain('max="12"')
  expect(markup).toContain('step="0.05"')
})

it("preserves precise valid lookahead steps while rejecting temporary invalid drafts", () => {
  // Given / When / Then
  expect(parseLookaheadDraft("0.25")).toEqual({ kind: "valid", value: 0.25 })
  expect(parseLookaheadDraft("0.5")).toEqual({ kind: "valid", value: 0.5 })
  expect(parseLookaheadDraft("")).toMatchObject({ kind: "invalid" })
  expect(parseLookaheadDraft("12.05")).toMatchObject({ kind: "invalid" })
  expect(parseLookaheadDraft("0.26")).toEqual({
    kind: "invalid",
    message: "Use increments of 0.05 seconds.",
  })
})

it("renders the production primitive harness without fake chart or agent content", () => {
  // Given the reusable primitive state harness
  // When it renders for the production gallery
  const markup = renderToStaticMarkup(createElement(PrimitiveStateHarness))

  // Then applicable control states are present without fabricated workflow data
  expect(markup).toContain("Button states")
  expect(markup).toContain("Tool and status states")
  expect(markup).toContain("Field states")
  expect(markup).toContain("Selection controls")
  expect(markup).toContain("Disabled tool")
  expect(markup).not.toContain("Rebalance crossover phrase")
  expect(markup).not.toContain("Example cell")
})

it("shows persistent side labels above both physical playfields", async () => {
  // Given the physical pad preview for a native chart
  const demo = await loadDemo(repoRoot)

  // When the reusable pads render
  const markup = renderToStaticMarkup(
    createElement(PlayfieldPads, {
      chart: demo.document.project.chart,
      music: demo.document.project.music,
      playback: new AudioPlaybackController(demo.document.project),
      selectedTick: 0,
    }),
  )

  // Then pad side identity is visible rather than color-only
  expect(markup).toContain("Left pad · L")
  expect(markup).toContain("Right pad · R")
})

it("renders one pad and five approach lanes for Single mode", async () => {
  // Given a stored Single chart
  const demo = await loadDemo(repoRoot)
  const playback = new AudioPlaybackController(demo.document.project)

  // When the reusable preview surfaces render
  const player = renderToStaticMarkup(
    createElement(ScrollingChartPreview, {
      chart: demo.document.project.chart,
      music: demo.document.project.music,
      mode: "Single",
      playback,
      selectedTick: 0,
    }),
  )
  const pads = renderToStaticMarkup(
    createElement(PlayfieldPads, {
      chart: demo.document.project.chart,
      music: demo.document.project.music,
      mode: "Single",
      playback,
      selectedTick: 0,
    }),
  )

  // Then right-pad controls and lanes are absent rather than merely relabelled
  expect(player).toContain("Scrolling 5-lane Single chart preview")
  expect(player).not.toContain("Right pad · R")
  expect(pads).toContain("Left pad · L")
  expect(pads).not.toContain("Right pad · R")
})
