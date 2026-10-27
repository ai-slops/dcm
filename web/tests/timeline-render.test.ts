import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { Timeline } from "../src/ui/Timeline.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it.each([2, 4, 8])(
  "keeps off-grid taps and complete holds visible at quantization %s",
  async (quantize) => {
    // Given valid native notes that do not fall on the editing snap grid
    const demo = await loadDemo(repoRoot)
    const chart = {
      ...demo.document.project.chart,
      notes: [
        { tick: 1, panel_mask: 1, hold_ticks: 0 },
        { tick: 3, panel_mask: 2, hold_ticks: 4 },
      ],
    }
    // When the editor uses a coarser future-edit quantization
    const markup = renderToStaticMarkup(
      createElement(Timeline, {
        chart,
        music: demo.document.project.music,
        ucsMode: "Double",
        playback: new AudioPlaybackController(demo.document.project),
        selectedTick: 0,
        selectedLane: 0,
        quantize,
        onQuantize: () => undefined,
        onCell: () => undefined,
        onSelect: () => undefined,
      }),
    )
    // Then existing data retains its actual native row and note type
    expect(markup.includes('aria-label="L DL, tick 1, tap"')).toBe(true)
    expect(markup.includes('aria-label="L UL, tick 3, hold-head"')).toBe(true)
    expect(markup.includes('aria-label="L UL, tick 4, hold-body"')).toBe(true)
    expect(markup.includes('aria-label="L UL, tick 7, hold-tail"')).toBe(true)
  },
)

it("renders only the five playable lanes for a Single chart", async () => {
  // Given a chart whose required mode is Single
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

  // Then the editor and constraints expose one five-panel pad
  expect(markup).toContain("Single · 5 lanes · left pad")
  expect(markup).toContain("L DR")
  expect(markup).not.toContain("R DR")
})
