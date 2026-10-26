import { describe, expect, it } from "vitest"

import { AgentRunSnapshotSchema, AgentStreamEventSchema } from "../shared/index.ts"
import {
  activityFromSnapshot,
  appendAgentEvent,
  focusAfterSnapshotRefresh,
  initialModelId,
  proposalDecisionHistory,
  recoverAgentRun,
} from "../src/ui/agent-run-state.ts"

describe("agent run recovery", () => {
  it("restores safe terminal errors with the failed run", () => {
    const snapshot = AgentRunSnapshotSchema.parse({
      id: "failed-run",
      base_revision: 0,
      status: "failed",
      prompt: "Inspect",
      last_sequence: 5,
      error: { code: "agent_provider_request", message: "Agent provider request failed" },
    })
    const activity = activityFromSnapshot(snapshot)
    expect(activity).toContainEqual(
      expect.objectContaining({
        kind: "event",
        text: "agent_provider_request: Agent provider request failed",
      }),
    )
  })

  it("restores the latest terminal snapshot when no run is active", () => {
    // Given
    const latest = AgentRunSnapshotSchema.parse({
      id: "run-latest",
      base_revision: 7,
      status: "completed" as const,
      prompt: "Evaluate the chart",
      last_sequence: 4,
      text: "The finite-model evaluation completed.",
      tool_calls: [],
    })

    // When
    const recovered = recoverAgentRun({ active_run: null, recent_runs: [latest] })

    // Then
    expect(recovered?.id).toBe("run-latest")
  })

  it("hydrates retained text and ordered tool calls from the canonical snapshot", () => {
    // Given
    const snapshot = AgentRunSnapshotSchema.parse({
      id: "run-1",
      base_revision: 7,
      status: "completed" as const,
      prompt: "Check timing",
      last_sequence: 8,
      text: "Timing was checked without changing the chart.",
      tool_calls: [
        {
          id: "call-1",
          tool_id: "read_document",
          state: "completed" as const,
          input_preview: '{"scope":"chart"}',
          output_preview: "Loaded revision 7",
        },
        {
          id: "call-2",
          tool_id: "evaluate_chart",
          state: "completed" as const,
          input_preview: '{"profile":"finite"}',
          output_preview: "Accepted",
        },
      ],
    })

    // When
    const activity = activityFromSnapshot(snapshot)

    // Then
    expect(activity.map((item) => item.kind)).toEqual(["prompt", "tool", "tool", "assistant"])
    expect(activity[2]).toMatchObject({ kind: "tool", call: { id: "call-2" } })
  })

  it("marks retained assistant text when the canonical snapshot was truncated", () => {
    // Given
    const snapshot = AgentRunSnapshotSchema.parse({
      id: "run-truncated",
      base_revision: 7,
      status: "completed",
      prompt: "Inspect all timing",
      last_sequence: 12,
      text: "Retained tail",
      text_truncated: true,
    })

    // When
    const activity = activityFromSnapshot(snapshot)

    // Then
    expect(activity).toContainEqual(
      expect.objectContaining({ kind: "assistant", text: "Retained tail", truncated: true }),
    )
  })

  it("updates an existing tool call in place when its completion arrives", () => {
    // Given
    const initial = appendAgentEvent(
      [],
      AgentStreamEventSchema.parse({
        run_id: "run-1",
        sequence: 1,
        type: "tool",
        tool_id: "evaluate_chart",
        state: "started",
        call_id: "call-1",
        input_preview: '{"profile":"finite"}',
      }),
    )

    // When
    const completed = appendAgentEvent(
      initial,
      AgentStreamEventSchema.parse({
        run_id: "run-1",
        sequence: 2,
        type: "tool",
        tool_id: "evaluate_chart",
        state: "completed",
        call_id: "call-1",
        output_preview: "Accepted",
      }),
    )

    // Then
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({
      kind: "tool",
      call: { id: "call-1", state: "completed", output_preview: "Accepted" },
    })
  })

  it("keeps a different active run focused when an owner snapshot refreshes", () => {
    // Given
    const active = AgentRunSnapshotSchema.parse({
      id: "run-active",
      base_revision: 8,
      status: "running",
      prompt: "Active task",
      last_sequence: 3,
    })
    const owner = AgentRunSnapshotSchema.parse({
      id: "run-owner",
      base_revision: 7,
      status: "completed",
      prompt: "Older proposal task",
      last_sequence: 9,
    })

    // When
    const focused = focusAfterSnapshotRefresh(active, owner)

    // Then
    expect(focused.id).toBe("run-active")
  })

  it("aggregates bounded decisions from recent owner snapshots", () => {
    // Given
    const runs = [
      AgentRunSnapshotSchema.parse({
        id: "run-new",
        base_revision: 5,
        status: "completed",
        prompt: "New",
        last_sequence: 4,
        proposal_decisions: [
          { id: "proposal-new", status: "applied", revision: 6, summary: "New decision" },
        ],
      }),
      AgentRunSnapshotSchema.parse({
        id: "run-old",
        base_revision: 2,
        status: "completed",
        prompt: "Old",
        last_sequence: 3,
        proposal_decisions: [{ id: "proposal-old", status: "rejected", summary: "Old decision" }],
      }),
    ]

    // When
    const decisions = proposalDecisionHistory(runs)

    // Then
    expect(decisions).toEqual([
      expect.objectContaining({ runId: "run-new", id: "proposal-new" }),
      expect.objectContaining({ runId: "run-old", id: "proposal-old" }),
    ])
  })
})

describe("agent model selection", () => {
  it("uses the configured model id as the initial selection", () => {
    // Given
    const agent = { model: "gpt-6.1-sol" }

    // When
    const selected = initialModelId(agent)

    // Then
    expect(selected).toBe("gpt-6.1-sol")
  })

  it("requires an explicit choice when no model is configured", () => {
    // Given
    const agent = { model: null }

    // When
    const selected = initialModelId(agent)

    // Then
    expect(selected).toBe("")
  })
})
