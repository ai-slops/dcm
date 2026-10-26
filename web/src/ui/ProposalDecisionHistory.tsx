import { CheckCircle2, XCircle } from "lucide-react"

import type { ProposalDecisionHistoryItem } from "./agent-run-state.ts"
import { Badge } from "./primitives.tsx"

export function ProposalDecisionHistory({
  decisions,
}: {
  readonly decisions: readonly ProposalDecisionHistoryItem[]
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
            Run {decision.runId} · BASE R{decision.baseRevision} ·{" "}
            {decision.status === "applied" && decision.revision !== undefined
              ? `Applied at revision R${decision.revision}`
              : "Rejected"}
          </p>
        </article>
      ))}
    </section>
  )
}
