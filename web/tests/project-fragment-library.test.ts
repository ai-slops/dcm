import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { ProjectFragmentLibrary } from "../src/ui/ProjectFragmentLibrary.tsx"

it("renders labelled exclusive publish range and apply anchor controls", () => {
  // Given / When
  const markup = renderToStaticMarkup(
    createElement(ProjectFragmentLibrary, {
      busy: false,
      components: [],
      onApply: () => undefined,
      onPublish: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Fragment name")
  expect(markup).toContain("Range start beat")
  expect(markup).toContain("Range end beat (exclusive)")
  expect(markup).toContain("Apply anchor beat")
  expect(markup).toContain("Publish note fragment")
  expect(markup).toContain("No note fragments published yet")
})
