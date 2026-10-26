import type { AgentRunSnapshot, AgentStreamEvent, Bootstrap } from "../../shared/index.ts"

export type AgentToolCall = NonNullable<AgentRunSnapshot["tool_calls"]>[number]

export type RecoverableAgentRun = AgentRunSnapshot

export type RecoverableBootstrap = Pick<Bootstrap, "active_run" | "recent_runs">

type ToolStreamEvent = Extract<AgentStreamEvent, { readonly type: "tool" }>

export type ObservableAgentEvent = AgentStreamEvent

export type AgentActivity =
  | {
      readonly key: string
      readonly kind: "prompt"
      readonly text: string
      readonly sequence?: number | undefined
    }
  | {
      readonly key: string
      readonly kind: "assistant"
      readonly text: string
      readonly sequence?: number | undefined
    }
  | {
      readonly key: string
      readonly kind: "event"
      readonly text: string
      readonly sequence: number
    }
  | {
      readonly key: string
      readonly kind: "tool"
      readonly call: AgentToolCall
      readonly sequence?: number | undefined
    }

export function initialModelId(agent: { readonly model: string | null }): string {
  return agent.model ?? ""
}

export function recoverAgentRun(bootstrap: RecoverableBootstrap): RecoverableAgentRun | null {
  if (bootstrap.active_run !== undefined && bootstrap.active_run !== null)
    return bootstrap.active_run
  return bootstrap.recent_runs?.[0] ?? null
}

export function activityFromSnapshot(snapshot: RecoverableAgentRun): readonly AgentActivity[] {
  const activity: AgentActivity[] = [
    { key: `prompt-${snapshot.id}`, kind: "prompt", text: `You: ${snapshot.prompt}` },
  ]
  for (const call of snapshot.tool_calls ?? []) {
    activity.push({ key: `tool-${call.id}`, kind: "tool", call })
  }
  if (snapshot.text !== undefined && snapshot.text !== "") {
    activity.push({
      key: `assistant-${snapshot.id}`,
      kind: "assistant",
      text: snapshot.text,
      sequence: snapshot.last_sequence,
    })
  }
  if (snapshot.error !== undefined) {
    activity.push({
      key: `error-${snapshot.id}`,
      kind: "event",
      text: `${snapshot.error.code}: ${snapshot.error.message}`,
      sequence: snapshot.last_sequence,
    })
  }
  return activity
}

function eventText(
  event: Exclude<AgentStreamEvent, { readonly type: "delta" | "completed" | "tool" | "snapshot" }>,
): string {
  switch (event.type) {
    case "status":
      return `Run ${event.status}`
    case "proposal":
      return `Proposal ready: ${event.proposal.summary}`
    case "error":
      return `${event.code}: ${event.message}`
  }
  const exhaustive: never = event
  return exhaustive
}

function appendToolEvent(
  activity: readonly AgentActivity[],
  event: ToolStreamEvent,
): readonly AgentActivity[] {
  const callId = event.call_id ?? `${event.tool_id}-${event.sequence}`
  const key = `tool-${callId}`
  const existing = activity.find((item) => item.kind === "tool" && item.key === key)
  const previous = existing?.kind === "tool" ? existing.call : undefined
  const outputPreview = event.output_preview ?? previous?.output_preview
  const toolError = event.error ?? previous?.error
  const truncated = event.truncated ?? previous?.truncated
  const call: AgentToolCall = {
    id: callId,
    tool_id: event.tool_id,
    state: event.state,
    input_preview: event.input_preview ?? previous?.input_preview ?? "",
    ...(outputPreview === undefined ? {} : { output_preview: outputPreview }),
    ...(toolError === undefined ? {} : { error: toolError }),
    ...(truncated === undefined ? {} : { truncated }),
  }
  const item: AgentActivity = { key, kind: "tool", call, sequence: event.sequence }
  if (existing === undefined) return [...activity, item]
  return activity.map((current) => (current.key === key ? item : current))
}

export function appendAgentEvent(
  activity: readonly AgentActivity[],
  event: ObservableAgentEvent,
): readonly AgentActivity[] {
  if (activity.some((item) => item.sequence === event.sequence)) return activity
  if (event.type === "snapshot") return activityFromSnapshot(event.snapshot)
  if (event.type === "tool") return appendToolEvent(activity, event)
  if (event.type === "delta" || event.type === "completed") {
    const key = `assistant-${event.run_id}`
    const existing = activity.find((item) => item.kind === "assistant" && item.key === key)
    const existingText = existing?.kind === "assistant" ? existing.text : ""
    const text = event.type === "completed" ? event.text : `${existingText}${event.text}`
    const item: AgentActivity = { key, kind: "assistant", text, sequence: event.sequence }
    return [...activity.filter((current) => current.key !== key), item]
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
