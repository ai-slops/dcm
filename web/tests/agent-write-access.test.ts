import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AgentRunRequestSchema } from "../shared/index.ts"
import { AgentComposer } from "../src/ui/AgentComposer.tsx"
import { buildAgentRunRequest } from "../src/ui/agent-run-request.ts"

describe("agent project write access", () => {
  it("renders a visible unchecked write permission", () => {
    // Given / When
    const markup = renderToStaticMarkup(
      createElement(AgentComposer, {
        agent: { configured: true, provider: "fixture", model: "fixture" },
        prompt: "Inspect projects",
        modelId: "fixture",
        dirty: false,
        running: false,
        busy: null,
        allowProjectWrites: false,
        onPrompt: () => undefined,
        onModel: () => undefined,
        onProjectWrites: () => undefined,
        onStart: () => undefined,
        onCancel: () => undefined,
      }),
    )

    // Then
    expect(markup).toContain("Allow project and library writes")
    expect(markup).toContain('type="checkbox"')
    expect(markup).not.toContain('checked=""')
  })

  it("sends explicit write access chosen by the user", () => {
    // Given
    const input = {
      baseRevision: AgentRunRequestSchema.parse({ base_revision: 4, prompt: "fixture" })
        .base_revision,
      prompt: "Update rules",
      modelId: "fixture",
      writeAccess: "projects_and_components" as const,
    }

    // When
    const request = buildAgentRunRequest(input)

    // Then
    expect(AgentRunRequestSchema.parse(request).write_access).toBe("projects_and_components")
  })
})
