import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AgentStreamEvent,
  AgentStreamEventSchema,
} from "../../shared/index.ts"

const MAX_EVENTS = 512

type Listener = (event: AgentStreamEvent | undefined) => void
export type EventPayload = {
  [Type in AgentStreamEvent["type"]]: Omit<
    Extract<AgentStreamEvent, { readonly type: Type }>,
    "run_id" | "sequence"
  >
}[AgentStreamEvent["type"]]

export class RunEvents {
  readonly events: AgentStreamEvent[] = []
  readonly #listeners = new Set<Listener>()
  #snapshot: AgentRunSnapshot
  #closed = false

  constructor(
    snapshot: AgentRunSnapshot,
    readonly onSnapshot: (snapshot: AgentRunSnapshot) => void,
  ) {
    this.#snapshot = snapshot
  }

  get snapshot(): AgentRunSnapshot {
    return this.#snapshot
  }

  setStatus(status: AgentRunSnapshot["status"]): void {
    this.#snapshot = AgentRunSnapshotSchema.parse({ ...this.#snapshot, status })
    this.onSnapshot(this.#snapshot)
  }

  configure(model: string, api: "chat" | "responses"): void {
    this.#snapshot = AgentRunSnapshotSchema.parse({ ...this.#snapshot, model, api })
    this.onSnapshot(this.#snapshot)
  }

  recordDecision(decision: NonNullable<AgentRunSnapshot["proposal_decisions"]>[number]): void {
    this.#snapshot = AgentRunSnapshotSchema.parse({
      ...this.#snapshot,
      proposal_decisions: [...(this.#snapshot.proposal_decisions ?? []), decision].slice(-16),
    })
    this.onSnapshot(this.#snapshot)
  }

  publish(payload: EventPayload): void {
    const sequence = this.events.length === 0 ? 0 : (this.events.at(-1)?.sequence ?? 0) + 1
    const event = AgentStreamEventSchema.parse({
      ...payload,
      run_id: this.#snapshot.id,
      sequence,
    })
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.shift()
    this.#snapshot = AgentRunSnapshotSchema.parse(applyEvent(this.#snapshot, event))
    this.onSnapshot(this.#snapshot)
    for (const listener of this.#listeners) listener(event)
  }

  replay(after: number): readonly AgentStreamEvent[] {
    return this.events.filter((event) => event.sequence > after)
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const listener of this.#listeners) listener(undefined)
    this.#listeners.clear()
  }
}

function applyEvent(snapshot: AgentRunSnapshot, event: AgentStreamEvent): AgentRunSnapshot {
  const base = { ...snapshot, last_sequence: event.sequence }
  switch (event.type) {
    case "snapshot":
      return event.snapshot
    case "delta":
      return { ...base, text: `${snapshot.text ?? ""}${event.text}`.slice(0, 65_536) }
    case "completed":
      return { ...base, text: event.text.slice(0, 65_536) }
    case "tool": {
      const calls = [...(snapshot.tool_calls ?? [])]
      const id = event.call_id ?? `${event.tool_id}-${event.sequence}`
      const index = calls.findIndex((call) => call.id === id)
      const call = {
        id,
        tool_id: event.tool_id,
        state: event.state,
        input_preview: event.input_preview ?? calls[index]?.input_preview ?? "",
        ...(event.output_preview === undefined ? {} : { output_preview: event.output_preview }),
        ...(event.error === undefined ? {} : { error: event.error }),
        ...(event.truncated === undefined ? {} : { truncated: event.truncated }),
      }
      if (index < 0) calls.push(call)
      else calls[index] = call
      return { ...base, tool_calls: calls.slice(-64) }
    }
    case "status":
    case "proposal":
      return base
    case "error":
      return { ...base, error: { code: event.code, message: event.message } }
  }
}
