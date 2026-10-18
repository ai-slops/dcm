import type { AgentStreamEvent } from "../../shared/index.ts"

export type AgentActivity = {
  readonly key: string
  readonly kind: "assistant" | "event" | "prompt"
  readonly text: string
  readonly sequence?: number
}

export function initialAgentActivity(runId: string, prompt: string): readonly AgentActivity[] {
  return [{ key: `prompt-${runId}`, kind: "prompt", text: `You: ${prompt}` }]
}

function eventText(event: AgentStreamEvent): string {
  switch (event.type) {
    case "status":
      return `Run ${event.status}`
    case "tool":
      return `Tool ${event.tool_id} ${event.state}`
    case "proposal":
      return `Proposal ready: ${event.proposal.summary}`
    case "error":
      return `${event.code}: ${event.message}`
    case "delta":
    case "completed":
      return event.text
  }
}

export function appendAgentEvent(
  activity: readonly AgentActivity[],
  event: AgentStreamEvent,
): readonly AgentActivity[] {
  if (activity.some((item) => item.sequence === event.sequence)) return activity
  if (event.type === "delta" || event.type === "completed") {
    const key = `assistant-${event.run_id}`
    const existing = activity.find((item) => item.key === key)
    const text = event.type === "completed" ? event.text : `${existing?.text ?? ""}${event.text}`
    return [
      ...activity.filter((item) => item.key !== key),
      { key, kind: "assistant", text, sequence: event.sequence },
    ]
  }
  return [
    ...activity,
    {
      key: `${event.run_id}-${event.sequence}`,
      kind: "event",
      text: eventText(event),
      sequence: event.sequence,
    },
  ]
}
