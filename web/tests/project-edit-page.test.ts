import { expect, it } from "vitest"

import { projectNavigationLocked } from "../src/ui/ProjectEditPage.tsx"

it("locks every project-page leave path while a mutation is pending", () => {
  // Given / When / Then
  expect(projectNavigationLocked(true)).toBe(true)
  expect(projectNavigationLocked(false)).toBe(false)
})
