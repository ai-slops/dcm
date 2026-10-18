import { randomBytes, randomUUID } from "node:crypto"

import {
  AgentRunIdSchema,
  type AgentRunSnapshot,
  type ChartProposal,
  ProposalIdSchema,
  SessionIdSchema,
} from "../shared/index.ts"

export type StudioSession = {
  readonly id: ReturnType<typeof SessionIdSchema.parse>
  readonly csrfToken: string
  readonly proposals: Map<string, ChartProposal>
  readonly runs: Map<string, AgentRunSnapshot>
  activeRunId: string | undefined
}

export class SessionStore {
  readonly #sessions = new Map<string, StudioSession>()

  get(id: string | undefined): StudioSession | undefined {
    return id === undefined ? undefined : this.#sessions.get(id)
  }

  create(): StudioSession {
    const session: StudioSession = {
      id: SessionIdSchema.parse(randomUUID()),
      csrfToken: randomBytes(32).toString("base64url"),
      proposals: new Map(),
      runs: new Map(),
      activeRunId: undefined,
    }
    this.#sessions.set(session.id, session)
    return session
  }

  proposalId(): ReturnType<typeof ProposalIdSchema.parse> {
    return ProposalIdSchema.parse(randomUUID())
  }

  runId(): ReturnType<typeof AgentRunIdSchema.parse> {
    return AgentRunIdSchema.parse(randomUUID())
  }
}
