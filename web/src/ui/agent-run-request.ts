import type { AgentRunRequest, AgentWriteAccess, Revision } from "../../shared/index.ts"

export function buildAgentRunRequest(input: {
  readonly baseRevision: Revision
  readonly prompt: string
  readonly modelId: string
  readonly writeAccess: AgentWriteAccess
}): AgentRunRequest {
  return {
    base_revision: input.baseRevision,
    prompt: input.prompt,
    write_access: input.writeAccess,
    ...(input.modelId === "" ? {} : { model_id: input.modelId }),
  }
}
