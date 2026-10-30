import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { CurrentDocumentSchema, StudioProjectV1Schema } from "../shared/index.ts"
import { UcsActionsDialog } from "../src/ui/UcsActionsDialog.tsx"
import { repoRoot } from "./support/paths.ts"

async function beatDemo() {
  const demo = await loadDemo(repoRoot)
  const legacy = StudioProjectV1Schema.parse(demo.document.project)
  return {
    project: migrateLegacyChart({ ...legacy, chart: { ...legacy.chart, notes: [] } }),
    revision: demo.document.revision,
  }
}

function currentDocument(
  project: Awaited<ReturnType<typeof beatDemo>>["project"],
  revision: Awaited<ReturnType<typeof beatDemo>>["revision"],
) {
  return CurrentDocumentSchema.parse({ project, revision })
}

function buttonOpeningTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(`<span>${label}</span>`)
  const buttonStart = markup.lastIndexOf("<button", labelIndex)
  const buttonEnd = markup.indexOf(">", buttonStart)
  return markup.slice(buttonStart, buttonEnd + 1)
}

describe("UCS transfer dialog", () => {
  it("defaults older projects to Double export mode", async () => {
    // Given a persisted project without a UCS mode preference
    const demo = await beatDemo()

    // When the dedicated transfer dialog is rendered
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: false,
        open: true,
        project: demo.project,
        document: currentDocument(demo.project, demo.revision),
        revision: demo.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then Double is explicit and audio fallback copy is visible
    expect(markup).toContain("Chart mode:")
    expect(markup).toContain("Double")
    expect(markup).toContain("Existing charts cannot change mode")
    expect(markup).toContain("Omit audio to keep the current project audio")
    expect(markup).toMatch(/<input[^>]*accept="\.zip,application\/zip"[^>]*name="ucs-zip"/)
    expect(markup).toContain("ZIP import requires bundled music")
  })

  it("disables replacement import for a dirty draft", async () => {
    // Given a project with unsaved edits
    const demo = await beatDemo()

    // When the transfer dialog is rendered in dirty state
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: true,
        open: true,
        project: demo.project,
        document: currentDocument(demo.project, demo.revision),
        revision: demo.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then the blocking reason and disabled chart picker are both present
    expect(markup).toContain("Save or undo your changes before importing UCS")
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*name="chart"/)
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*name="ucs-zip"/)
    expect(markup).toContain("Save your changes before exporting UCS")
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Download UCS/s)
  })

  it("keeps direct UCS export available for automatic duration", async () => {
    // Given a clean beat document whose authored duration is automatic
    const demo = await beatDemo()
    const project = {
      ...demo.project,
      timing: { ...demo.project.timing, duration: null },
      notes: [
        {
          at: { numerator: 0, denominator: 1 },
          hold: { numerator: 0, denominator: 1 },
          panel_mask: 1,
        },
      ],
    }

    // When the transfer dialog renders
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: false,
        open: true,
        project,
        document: currentDocument(project, demo.revision),
        revision: demo.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then export uses the backend's derived occupied extent without persisting fake duration
    expect(buttonOpeningTag(markup, "Download UCS")).not.toContain('disabled=""')
    expect(markup).not.toContain("Set a concrete duration")
  })

  it("explains why an empty automatic chart cannot export", async () => {
    // Given a clean automatic-duration document with no occupied extent
    const demo = await beatDemo()
    const project = { ...demo.project, timing: { ...demo.project.timing, duration: null } }

    // When the transfer dialog renders
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: false,
        open: true,
        project,
        document: currentDocument(project, demo.revision),
        revision: demo.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then export is disabled until an automatic extent exists
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Download UCS/s)
    expect(markup).toContain("Add a note or set an explicit duration before exporting UCS")
  })

  it("enables empty automatic export from trusted generated-region context", async () => {
    // Given an empty automatic draft whose persisted generated origin ends at beat eight
    const demo = await beatDemo()
    const project = { ...demo.project, timing: { ...demo.project.timing, duration: null } }
    const document = CurrentDocumentSchema.parse({
      project,
      revision: demo.revision,
      origin: {
        project_id: "00000000-0000-4000-8000-000000000001",
        project_revision: 1,
        seed: "0".repeat(64),
        automatic_regions: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            name: "Generated rest",
            start: { numerator: 0, denominator: 1 },
            end: { numerator: 8, denominator: 1 },
          },
        ],
      },
    })

    // When the transfer dialog resolves output capability
    const markup = renderToStaticMarkup(
      createElement(UcsActionsDialog, {
        csrfToken: "csrf",
        dirty: false,
        open: true,
        project,
        document,
        revision: demo.revision,
        onClose: () => undefined,
        onDocument: () => undefined,
        onStatus: () => undefined,
      }),
    )

    // Then the trusted region extent enables export without persisting a duration
    expect(buttonOpeningTag(markup, "Download UCS")).not.toContain('disabled=""')
    expect(project.timing.duration).toBeNull()
  })
})
