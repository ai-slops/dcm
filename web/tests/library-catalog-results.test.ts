import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { UcsCatalogResultSchema } from "../shared/library.ts"
import { LibraryCatalogResults } from "../src/ui/LibraryCatalogSearch.tsx"

describe("library catalog results", () => {
  it("renders package identifiers and download actions without artist claims", () => {
    // Given
    const catalog = UcsCatalogResultSchema.parse({
      query: "nemonemo",
      count: 1,
      items: [{ code: "CS839", title: "Nemonemo", artist: "Yena", bpm: "138" }],
      source_url: "https://pump-pro.example/catalog",
    })

    // When
    const markup = renderToStaticMarkup(
      createElement(LibraryCatalogResults, {
        busy: false,
        result: catalog,
        onDownload: () => undefined,
      }),
    )

    // Then
    expect(markup).toContain("Nemonemo")
    expect(markup).not.toContain("Yena")
    expect(markup).toContain("138 BPM")
    expect(markup).toContain("CS839")
    expect(markup).toContain("Download")
  })
})
