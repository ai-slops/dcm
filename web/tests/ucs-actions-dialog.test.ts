import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { UcsActionsDialog } from "../src/ui/UcsActionsDialog.tsx"
import { repoRoot } from "./support/paths.ts"

describe("UCS transfer dialog", () => {
  it("defaults older projects to Double export mode", async () => {
    // Given a persisted project without a UCS mode preference
    const demo = await loadDemo(repoRoot)

    // When the dedicated transfer dialog is rendered
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: false,
        open: true,
        project: demo.document.project,
        revision: demo.document.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then Double is explicit and audio fallback copy is visible
    expect(markup).toMatch(/<input[^>]*checked=""[^>]*value="Double"/)
    expect(markup).toContain("Omit audio to keep the current project audio")
  })

  it("disables replacement import for a dirty draft", async () => {
    // Given a project with unsaved edits
    const demo = await loadDemo(repoRoot)

    // When the transfer dialog is rendered in dirty state
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: true,
        open: true,
        project: demo.document.project,
        revision: demo.document.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then the blocking reason and disabled chart picker are both present
    expect(markup).toContain("Save or undo your changes before importing UCS")
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*name="chart"/)
    expect(markup).toContain("Save your changes before exporting UCS")
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Download UCS/s)
  })
})
