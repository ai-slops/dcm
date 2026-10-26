import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { Timeline } from "../src/ui/Timeline.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("shows how Single export preference maps onto the ten-lane DCM chart", async () => {
  // Given a native ten-lane chart whose UCS preference is Single
  const demo = await loadDemo(repoRoot)
  const playback = new AudioPlaybackController(demo.document.project)

  // When the timeline is rendered
  const markup = renderToStaticMarkup(
    createElement(Timeline, {
      chart: demo.document.project.chart,
      music: demo.document.project.music,
      ucsMode: "Single",
      playback,
      selectedTick: 0,
      selectedLane: 0,
      quantize: 1,
      onQuantize: () => undefined,
      onCell: () => undefined,
      onSelect: () => undefined,
    }),
  )

  // Then preference context is explicit without hiding the right pad lanes
  expect(markup).toContain("DCM 10 lanes · UCS Single uses left pad")
  expect(markup).toContain("R DR")
})
