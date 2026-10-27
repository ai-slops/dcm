import { expect, it } from "vitest"

import { buildAgentPrompt } from "../server/agent/agent-prompt.ts"
import { AgentRunSnapshotSchema } from "../shared/index.ts"

it("provides selected project identity and revision in structural agent context", () => {
  // Given
  const snapshot = AgentRunSnapshotSchema.parse({
    id: "run-1",
    base_revision: 2,
    status: "queued",
    prompt: "Inspect",
    last_sequence: 0,
    write_access: "read_only",
    selected_project: {
      id: "00000000-0000-4000-8000-000000000001",
      revision: 7,
    },
  })

  // When
  const prompt = buildAgentPrompt(snapshot)
  const contextText = /<project-context>([^<]+)<\/project-context>/.exec(prompt)?.[1]
  const context: unknown = contextText === undefined ? undefined : JSON.parse(contextText)

  // Then
  expect(context).toEqual({
    selected_project: {
      id: "00000000-0000-4000-8000-000000000001",
      revision: 7,
    },
    write_access: "read_only",
  })
})
