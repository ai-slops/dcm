import { describe, expect, it } from "vitest"

import { AgentStreamEventSchema } from "../shared/index.ts"
import { appendAgentEvent, initialAgentActivity } from "../src/ui/agent-events.ts"

describe("agent activity", () => {
  it("preserves the submitted prompt as the first activity", () => {
    // Given
    const prompt = "왼쪽 패턴을 단순하게 바꿔 주세요."

    // When
    const activity = initialAgentActivity("run-1", prompt)

    // Then
    expect(activity[0]?.text).toBe(`You: ${prompt}`)
  })

  it("replaces streamed deltas with completed text instead of duplicating it", () => {
    // Given
    const events = [
      { run_id: "run-1", sequence: 1, type: "delta", text: "Changed " },
      { run_id: "run-1", sequence: 2, type: "delta", text: "the chart." },
      { run_id: "run-1", sequence: 3, type: "completed", text: "Changed the chart." },
    ].map((event) => AgentStreamEventSchema.parse(event))

    // When
    const activity = events.reduce<ReturnType<typeof initialAgentActivity>>(
      appendAgentEvent,
      initialAgentActivity("run-1", "Change it"),
    )

    // Then
    expect(activity.filter((item) => item.kind === "assistant")).toEqual([
      { key: "assistant-run-1", kind: "assistant", text: "Changed the chart.", sequence: 3 },
    ])
  })

  it("ignores an event sequence already represented in activity", () => {
    // Given
    const event = AgentStreamEventSchema.parse({
      run_id: "run-1",
      sequence: 4,
      type: "tool",
      tool_id: "propose_chart",
      state: "completed",
    })
    const current = appendAgentEvent(initialAgentActivity("run-1", "Change it"), event)

    // When
    const activity = appendAgentEvent(current, event)

    // Then
    expect(activity).toEqual(current)
  })
})
