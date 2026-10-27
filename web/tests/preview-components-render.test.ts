import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { PrimitiveStateHarness } from "../src/ui/PrimitiveShowcase.tsx"
import { ScrollingChartPreview } from "../src/ui/ScrollingChartPreview.tsx"
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
  expect(markup).toContain('aria-label="Preview lookahead"')
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
