import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
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
      project: { ...demo.document.project, ucs_mode: "Single" },
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
