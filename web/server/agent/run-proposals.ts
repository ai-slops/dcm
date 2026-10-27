import type { AgentRunSnapshot, CurrentDocument } from "../../shared/index.ts"
import { MAX_SESSION_PROPOSALS } from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { StudioSession } from "../sessions.ts"
import type { ProposalInput } from "./part-runtime.ts"
import { buildAgentProposal } from "./proposal.ts"

const MAX_RUN_PROPOSALS = 4

type RunProposalWriterOptions = {
  readonly session: StudioSession
  readonly document: CurrentDocument
  readonly runId: AgentRunSnapshot["id"]
  readonly active: () => boolean
  readonly publish: (proposal: ReturnType<typeof buildAgentProposal>) => void
}

export class RunProposalWriter {
  readonly #options: RunProposalWriterOptions

  constructor(options: RunProposalWriterOptions) {
    this.#options = options
  }

  async create(input: ProposalInput, signal: AbortSignal) {
    if (!this.#options.active() || signal.aborted)
      throw new StudioError(409, "run_cancelled", "Run is no longer active")
    await Promise.resolve()
    if (!this.#options.active() || signal.aborted)
      throw new StudioError(409, "run_cancelled", "Run is no longer active")
    const owned = [...this.#options.session.proposals.values()].filter(
      (proposal) => proposal.source === "agent" && proposal.run_id === this.#options.runId,
    )
    if (owned.length >= MAX_RUN_PROPOSALS)
      throw new StudioError(409, "proposal_limit", "Run proposal limit reached")
    if (this.#options.session.proposals.size >= MAX_SESSION_PROPOSALS)
      throw new StudioError(409, "proposal_limit", "Review pending proposals before creating more")
    const proposal = buildAgentProposal(this.#options.document, input, this.#options.runId)
    this.#options.session.proposals.set(proposal.id, proposal)
    this.#options.publish(proposal)
    return { proposal_id: proposal.id }
  }
}
