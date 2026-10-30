import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { CurrentDocumentSchema } from "../shared/index.ts"
import { NativeActionsDialog } from "../src/ui/NativeActionsDialog.tsx"
import { repoRoot } from "./support/paths.ts"

it("routes Single charts to rule projects and UCS instead of Pump Double native actions", async () => {
  // Given
  const demo = await loadDemo(repoRoot)

  // When
  const project = { ...migrateLegacyChart(demo.document.project), mode: "Single" as const }
  const markup = renderToStaticMarkup(
    createElement(NativeActionsDialog, {
      csrfToken: "csrf",
      dirty: false,
      nativeMessage: "Native runtime ready",
      nativeReady: true,
      open: true,
      project,
      document: CurrentDocumentSchema.parse({ project, revision: demo.document.revision }),
      revision: demo.document.revision,
      onClose: () => undefined,
      onOpenProjects: () => undefined,
      onOpenUcs: () => undefined,
      onProposal: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Single charts do not use legacy proposal generation")
  expect(markup).toContain("Projects and library")
  expect(markup).toContain("UCS transfer")
  expect(markup).toContain("Evaluate")
  expect(markup).not.toContain("Generate proposal")
  expect(markup).not.toContain("Download SSC ZIP")
})

it("discloses evaluation extent limits for automatic-duration native actions", async () => {
  // Given an automatic-duration chart whose evaluation window exceeds its occupied output extent
  const demo = await loadDemo(repoRoot)
  const project = migrateLegacyChart(demo.document.project)
  const automatic = {
    ...project,
    timing: { ...project.timing, duration: null },
    evaluation_contract: {
      ...project.evaluation_contract,
      difficulty: {
        ...project.evaluation_contract.difficulty,
        local_windows: [
          {
            width: { numerator: 100, denominator: 1 },
            maximum_load: 100,
          },
        ],
      },
    },
  }

  // When the native actions dialog evaluates capability
  const markup = renderToStaticMarkup(
    createElement(NativeActionsDialog, {
      csrfToken: "csrf",
      dirty: false,
      nativeMessage: "Native runtime ready",
      nativeReady: true,
      open: true,
      project: automatic,
      document: CurrentDocumentSchema.parse({
        project: automatic,
        revision: demo.document.revision,
      }),
      revision: demo.document.revision,
      onClose: () => undefined,
      onOpenProjects: () => undefined,
      onOpenUcs: () => undefined,
      onProposal: () => undefined,
    }),
  )

  // Then every native action is disabled with the shared capability reason
  expect(markup).toContain("exceeds the native output duration")
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Generate proposal/s)
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Evaluate/s)
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Download SSC ZIP/s)
})

it("uses trusted generated-region context for automatic native capability", async () => {
  // Given an empty automatic draft with a trusted generated region extent
  const demo = await loadDemo(repoRoot)
  const source = migrateLegacyChart(demo.document.project)
  const project = { ...source, timing: { ...source.timing, duration: null }, notes: [] }
  const document = CurrentDocumentSchema.parse({
    project,
    revision: demo.document.revision,
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

  // When native capability is rendered
  const markup = renderToStaticMarkup(
    createElement(NativeActionsDialog, {
      csrfToken: "csrf",
      dirty: false,
      nativeMessage: "Native runtime ready",
      nativeReady: true,
      open: true,
      project,
      document,
      revision: demo.document.revision,
      onClose: () => undefined,
      onOpenProjects: () => undefined,
      onOpenUcs: () => undefined,
      onProposal: () => undefined,
    }),
  )

  // Then region-only automatic output is not rejected as unresolved
  expect(markup).not.toContain("Set a concrete duration before native evaluation")
  expect(project.timing.duration).toBeNull()
})
