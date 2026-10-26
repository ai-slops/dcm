import { StudioError } from "../errors.ts"

export function safeFailure(error: unknown): [string, string] {
  if (error instanceof StudioError) return [error.code, error.message]
  return ["agent_runtime_failed", "Agent run failed"]
}

export function safeProviderMessage(code: string): string {
  if (/auth|unauthorized|forbidden/i.test(code)) return "Agent provider authentication failed"
  if (/rate|quota|limit/i.test(code)) return "Agent provider rate limit was reached"
  if (/model|unsupported/i.test(code)) return "Selected agent model is unavailable or incompatible"
  if (/timeout|network|transport/i.test(code)) return "Agent provider could not be reached"
  return "Agent provider request failed"
}

export function safeProviderCode(code: string): string {
  if (/auth|unauthorized|forbidden/i.test(code)) return "agent_provider_auth"
  if (/rate|quota|limit/i.test(code)) return "agent_provider_rate_limit"
  if (/model|unsupported/i.test(code)) return "agent_model_unavailable"
  if (/timeout|network|transport|http/i.test(code)) return "agent_provider_unavailable"
  return "agent_provider_request"
}
