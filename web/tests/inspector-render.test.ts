import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { StudioProjectV1Schema } from "../shared/index.ts"
import { Inspector } from "../src/ui/Inspector.tsx"
import { repoRoot } from "./support/paths.ts"

it("keeps song ownership read-only while chart artist remains editable", async () => {
  // Given a beat document with separate song and chart credits
  const demo = await loadDemo(repoRoot)
  const legacy = StudioProjectV1Schema.parse(demo.document.project)
  const project = {
    ...migrateLegacyChart({ ...legacy, chart: { ...legacy.chart, notes: [] } }),
    artist: "Song Owner",
    chart_artist: "Stepper",
  }

  // When the root Inspector renders
  const markup = renderToStaticMarkup(
    createElement(Inspector, {
      project,
      validationError: "",
      replaceProject: () => undefined,
    }),
  )

  // Then only the document-owned chart credit is mutable
  expect(markup).toMatch(/Chart artist[\s\S]*?<input(?![^>]*readonly)[^>]*value="Stepper"/)
  expect(markup).toMatch(/Song artist[\s\S]*?<input[^>]*readOnly=""[^>]*value="Song Owner"/)
})
