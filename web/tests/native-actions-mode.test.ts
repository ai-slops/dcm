import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { NativeActionsDialog } from "../src/ui/NativeActionsDialog.tsx"
import { repoRoot } from "./support/paths.ts"

it("routes Single charts to rule projects and UCS instead of Pump Double native actions", async () => {
  // Given
  const demo = await loadDemo(repoRoot)

  // When
  const markup = renderToStaticMarkup(
    createElement(NativeActionsDialog, {
      csrfToken: "csrf",
      dirty: false,
      nativeMessage: "Native runtime ready",
      nativeReady: true,
      open: true,
      project: { ...migrateLegacyChart(demo.document.project), mode: "Single" },
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
