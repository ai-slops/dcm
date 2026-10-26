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
    expect(activity[0]).toMatchObject({ kind: "prompt", text: `You: ${prompt}` })
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
      {
        key: "assistant-run-1",
        kind: "assistant",
        text: "Changed the chart.",
        truncated: false,
        sequence: 3,
      },
    ])
  })

  it("bounds aggregated UTF-8 deltas and marks the partial retained text", () => {
    let activity = initialAgentActivity("bounded", "Inspect")
    for (let sequence = 1; sequence <= 20; sequence += 1)
      activity = appendAgentEvent(
        activity,
        AgentStreamEventSchema.parse({
          type: "delta",
          run_id: "bounded",
          sequence,
          text: "😀".repeat(2_000),
        }),
      )
    const result = activity.find((item) => item.kind === "assistant")
    expect(result?.kind === "assistant" && Buffer.byteLength(result.text)).toBeLessThanOrEqual(
      65_536,
    )
    expect(result).toMatchObject({ truncated: true })
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
