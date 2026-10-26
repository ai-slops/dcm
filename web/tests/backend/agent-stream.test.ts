import { describe, expect, it } from "vitest"

import { RunEvents } from "../../server/agent/run-events.ts"
import { streamRunEvents } from "../../server/routes/agent.ts"
import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AgentStreamEvent,
  AgentStreamEventSchema,
} from "../../shared/index.ts"

describe("agent event streaming", () => {
  it("retains safe terminal errors in the canonical snapshot", () => {
    const stream = new RunEvents(
      AgentRunSnapshotSchema.parse({
        id: "failed-run",
        base_revision: 0,
        status: "failed",
        prompt: "Inspect",
        last_sequence: 0,
      }),
      () => undefined,
    )
    stream.publish({
      type: "error",
      code: "agent_provider_request",
      message: "Agent provider request failed",
    })
    expect(stream.snapshot).toMatchObject({
      error: { code: "agent_provider_request", message: "Agent provider request failed" },
    })
  })

  it("sends a canonical snapshot when retained events have a replay gap", async () => {
    // Given
    const snapshot = AgentRunSnapshotSchema.parse({
      id: "run-1",
      base_revision: 0,
      status: "completed",
      prompt: "test",
      last_sequence: 11,
      text: "complete",
      tool_calls: [],
      proposal_decisions: [],
    })
    const replayed = AgentStreamEventSchema.parse({
      run_id: "run-1",
      sequence: 10,
      type: "completed",
      text: "complete",
    })
    const written: string[] = []
    const record = {
      snapshot,
      replay: () => [replayed],
      subscribe: () => () => undefined,
    }
    const stream = {
      aborted: false,
      async writeSSE(message: { readonly event?: string }): Promise<void> {
        written.push(message.event ?? "")
      },
    }

    // When
    await streamRunEvents(record, 2, stream)

    // Then
    expect(written).toEqual(["snapshot"])
  })

  it("delivers an event published while a replay write is pending", async () => {
    // Given
    const replayed = AgentStreamEventSchema.parse({
      run_id: "run-1",
      sequence: 0,
      type: "status",
      status: "running",
    })
    const published = AgentStreamEventSchema.parse({
      run_id: "run-1",
      sequence: 1,
      type: "completed",
      text: "finished",
    })
    let snapshot: AgentRunSnapshot = AgentRunSnapshotSchema.parse({
      id: "run-1",
      base_revision: 0,
      status: "running",
      prompt: "test",
      last_sequence: 0,
    })
    const listeners = new Set<(event: AgentStreamEvent | undefined) => void>()
    let unsubscribed = false
    const written: string[] = []
    const record = {
      get snapshot() {
        return snapshot
      },
      replay: () => [replayed],
      subscribe(listener: (event: AgentStreamEvent | undefined) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribed = true
        }
      },
    }
    const stream = {
      aborted: false,
      async writeSSE(message: { readonly id?: string }): Promise<void> {
        written.push(message.id ?? "")
        if (message.id === "0") {
          snapshot = { ...snapshot, status: "completed", last_sequence: 1 }
          for (const listener of listeners) listener(published)
          for (const listener of listeners) listener(undefined)
          await Promise.resolve()
        }
      },
    }

    // When
    await streamRunEvents(record, -1, stream)

    // Then
    expect(written).toEqual(["0", "1"])
    expect(unsubscribed).toBe(true)
  })
})
