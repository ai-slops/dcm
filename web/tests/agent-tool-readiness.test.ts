import { expect, it } from "vitest"

import { agentToolReadiness } from "../server/agent/tool-readiness.ts"

it("advertises the complete bounded agent tool catalog", () => {
  // Given / When
  const tools = agentToolReadiness({
    native: { ready: true, message: "ready" },
    projects: { ready: true, message: "ready" },
    generatorCompatible: true,
  })

  // Then
  expect(tools).toHaveLength(16)
  expect(tools.map((tool) => tool.id)).toContain("list_songs")
  expect(tools.map((tool) => tool.id)).toContain("read_chart")
})
