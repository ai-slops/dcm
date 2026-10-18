import { streamSSE } from "hono/streaming"

import { AgentRunRequestSchema, type AgentStreamEvent } from "../../shared/index.ts"
import type { RunRecord } from "../agent/run-record.ts"
import { StudioError } from "../errors.ts"
import { parseJson } from "../http.ts"
import type { Services, StudioApp } from "../types.ts"

export function registerAgentRoutes(app: StudioApp, services: Services): void {
  app.post("/api/v1/agent/runs", async (context) => {
    const request = await parseJson(context, AgentRunRequestSchema)
    const document = services.store.document()
    if (request.base_revision !== document.revision) {
      throw new StudioError(
        409,
        "revision_conflict",
        "Document revision is stale",
        document.revision,
      )
    }
    const snapshot = services.runs.start(context.get("session"), document, request.prompt)
    return context.json(snapshot, 202)
  })

  app.get("/api/v1/agent/runs/:id", (context) => {
    return context.json(services.runs.get(context.get("session"), context.req.param("id")).snapshot)
  })

  app.delete("/api/v1/agent/runs/:id", async (context) => {
    const record = services.runs.get(context.get("session"), context.req.param("id"))
    return context.json(await record.cancel())
  })

  app.get("/api/v1/agent/runs/:id/events", (context) => {
    const record = services.runs.get(context.get("session"), context.req.param("id"))
    const after = parseLastEventId(context.req.header("last-event-id"))
    return streamSSE(context, (stream) => streamRunEvents(record, after, stream))
  })
}

export async function streamRunEvents(
  record: Pick<RunRecord, "replay" | "snapshot" | "subscribe">,
  after: number,
  stream: SseWriter & { readonly aborted: boolean },
): Promise<void> {
  const queue: AgentStreamEvent[] = []
  let closed = false
  let lastSequence = after
  let resume: (() => void) | undefined
  const unsubscribe = record.subscribe((event) => {
    if (event === undefined) closed = true
    else queue.push(event)
    resume?.()
  })
  try {
    for (const event of record.replay(after)) {
      if (stream.aborted) return
      if (event.sequence <= lastSequence) continue
      await writeEvent(stream, event)
      lastSequence = event.sequence
    }
    for (;;) {
      while (queue.length > 0) {
        const event = queue.shift()
        if (event === undefined || event.sequence <= lastSequence) continue
        if (stream.aborted) return
        await writeEvent(stream, event)
        lastSequence = event.sequence
      }
      if (
        closed ||
        stream.aborted ||
        ["completed", "cancelled", "failed"].includes(record.snapshot.status)
      )
        return
      await new Promise<void>((resolve) => (resume = resolve))
      resume = undefined
    }
  } finally {
    unsubscribe()
  }
}

type SseWriter = {
  readonly writeSSE: (message: {
    readonly data: string
    readonly event?: string
    readonly id?: string
  }) => Promise<void>
}

function writeEvent(stream: SseWriter, event: AgentStreamEvent): Promise<void> {
  return stream.writeSSE({
    id: String(event.sequence),
    event: event.type,
    data: JSON.stringify(event),
  })
}

function parseLastEventId(value: string | undefined): number {
  if (value === undefined) return -1
  if (!/^\d+$/.test(value))
    throw new StudioError(400, "last_event_id", "Last-Event-ID must be nonnegative")
  return Number(value)
}
