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

  publish(payload: EventPayload): void {
    const sequence = this.events.length === 0 ? 0 : (this.events.at(-1)?.sequence ?? 0) + 1
    const event = AgentStreamEventSchema.parse({
      ...payload,
      run_id: this.#snapshot.id,
      sequence,
    })
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.shift()
    this.#snapshot = AgentRunSnapshotSchema.parse({
      ...this.#snapshot,
      last_sequence: event.sequence,
    })
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
