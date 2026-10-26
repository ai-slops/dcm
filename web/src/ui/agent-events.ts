export {
  type AgentActivity,
  activityFromSnapshot,
  appendAgentEvent,
  initialModelId,
  recoverAgentRun,
} from "./agent-run-state.ts"

export function initialAgentActivity(
  runId: string,
  prompt: string,
): readonly import("./agent-run-state.ts").AgentActivity[] {
  return [{ key: `prompt-${runId}`, kind: "prompt", text: `You: ${prompt}` }]
}
