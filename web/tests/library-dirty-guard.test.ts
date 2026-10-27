import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LibraryDirtyGuard } from "../src/ui/LibraryDirtyGuard.tsx"

describe("library dirty guard", () => {
  it("renders the safe cancel action as the initial focus target", () => {
    // Given / When
    const markup = renderToStaticMarkup(
      createElement(LibraryDirtyGuard, {
        busy: false,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onCancel: () => undefined,
      }),
    )

    // Then
    expect(markup).toMatch(/<button[^>]*data-initial-focus="true"[^>]*>.*Cancel/s)
  })
})
