import { describe, expect, it } from "vitest"

import { createStudioResponsesAdapter } from "../server/agent/responses-adapter.ts"

function stream(events: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  )
}

const completed = {
  type: "response.completed",
  sequence_number: 3,
  response: {
    id: "response-1",
    object: "response",
    status: "completed",
    output: [
      {
        id: "message-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Inspected." }],
      },
    ],
  },
}

describe("Responses router metadata", () => {
  it("decodes completed output across byte-fragmented router metadata frames", () => {
    // Given
    const created = createStudioResponsesAdapter().createDecoder({
      headers: { "content-type": "text/event-stream" },
    })
    if (!created.ok) throw new TypeError(created.error.message)
    const bytes = stream([
      { type: "response.metadata", response_id: "response-1", sequence_number: 2, metadata: {} },
      completed,
    ])
    // When
    for (const byte of bytes) {
      const pushed = created.value.push(Uint8Array.of(byte))
      expect(pushed.ok).toBe(true)
    }
    const result = created.value.finish()
    // Then
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.content).toEqual([{ kind: "text", text: "Inspected." }])
  })

  it("still rejects incomplete responses and unknown semantic events", () => {
    // Given
    const created = createStudioResponsesAdapter().createDecoder({
      headers: { "content-type": "text/event-stream" },
    })
    if (!created.ok) throw new TypeError(created.error.message)
    // When
    const result = created.value.push(stream([{ type: "response.unknown", sequence_number: 1 }]))
    // Then
    expect(result.ok).toBe(false)
    expect(created.value.finish().ok).toBe(false)
  })
})
