import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { Transport } from "../src/ui/Transport.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("keeps one visible segment action in the responsive transport", async () => {
  // Given the Studio transport with its existing playback controller
  const demo = await loadDemo(repoRoot)
  const playback = new AudioPlaybackController(demo.document.project)

  // When the transport renders before audio metadata is ready
  const markup = renderToStaticMarkup(
    createElement(Transport, {
      project: demo.document.project,
      selectedTick: 999_999,
      onSeekSelection: () => undefined,
      playback,
    }),
  )

  // Then a labelled Segment action remains visible without inline range fields
  expect(markup).toMatch(/<button[^>]*>.*Segment.*<\/button>/s)
  expect(markup).toContain('class="transport__primary"')
  expect(markup).toContain('class="transport__secondary"')
  expect(markup).toContain("Loop")
  expect(markup).toContain('aria-label="Playback speed"')
  expect(markup).toContain('aria-label="Volume"')
  expect(markup).toContain("Chart tick 999999")
  expect(markup).toContain('class="transport__tick-prefix">TICK </span>999999')
  expect(markup).not.toContain("TICK 000999999")
  expect(markup).not.toContain('aria-label="Segment start')
  expect(markup).not.toContain('aria-label="Segment end')
})
