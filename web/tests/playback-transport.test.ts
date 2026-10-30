import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { StudioProjectV1Schema } from "../shared/index.ts"
import { SegmentPlaybackDialog } from "../src/ui/SegmentPlaybackDialog.tsx"
import { Transport } from "../src/ui/Transport.tsx"
import { AudioPlaybackController } from "../src/ui/useAudioPlayback.ts"
import { repoRoot } from "./support/paths.ts"

it("keeps one visible segment action in the responsive transport", async () => {
  // Given the Studio transport with its existing playback controller
  const demo = await loadDemo(repoRoot)
  const project = migrateLegacyChart(StudioProjectV1Schema.parse(demo.document.project))
  const playback = new AudioPlaybackController(project)

  // When the transport renders before audio metadata is ready
  const markup = renderToStaticMarkup(
    createElement(Transport, {
      project,
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
  expect(markup).toContain("Chart beat 0")
  expect(markup).toContain('class="transport__tick-prefix">BEAT </span>0')
  expect(markup).not.toContain('aria-label="Segment start')
  expect(markup).not.toContain('aria-label="Segment end')
})

it("describes segment projection through the single editor", async () => {
  // Given the segment dialog for the shared playback controller
  const demo = await loadDemo(repoRoot)
  const project = migrateLegacyChart(StudioProjectV1Schema.parse(demo.document.project))

  // When its explanatory copy renders
  const markup = renderToStaticMarkup(
    createElement(SegmentPlaybackDialog, {
      playback: new AudioPlaybackController(project),
      onClose: () => undefined,
    }),
  )

  // Then it names the single editor rather than a removed playfield
  expect(markup).toContain("for the editor")
  expect(markup).not.toContain("timeline and playfield")
})
