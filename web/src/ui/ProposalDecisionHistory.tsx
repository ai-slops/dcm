import { CheckCircle2, XCircle } from "lucide-react"

import type { AgentRunSnapshot } from "../../shared/index.ts"
import { Badge } from "./primitives.tsx"

type ProposalDecision = NonNullable<AgentRunSnapshot["proposal_decisions"]>[number]

export function ProposalDecisionHistory({
  decisions,
}: {
  readonly decisions: readonly ProposalDecision[]
}) {
  if (decisions.length === 0) return null

  return (
    <section aria-label="Proposal decision history">
      {decisions.map((decision) => (
        <article className="proposal" key={decision.id}>
          <div className="proposal__head">
            <div>
              <span className="proposal__eyebrow">Decision retained</span>
              <strong>{decision.summary}</strong>
            </div>
            <Badge tone={decision.status === "applied" ? "success" : "neutral"}>
              {decision.status === "applied" ? (
                <>
                  <CheckCircle2 size={12} /> Applied
                </>
              ) : (
                <>
                  <XCircle size={12} /> Rejected
                </>
              )}
            </Badge>
          </div>
          <p className="mono">
            {decision.status === "applied" && decision.revision !== undefined
              ? `Applied at revision R${decision.revision}`
              : "Rejected"}
          </p>
        </article>
      ))}
    </section>
  )
}
