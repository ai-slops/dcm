import { AlertTriangle, Check, X } from "lucide-react"

import type { ChartProposal } from "../../shared/index.ts"
import { ProposalDiff } from "./ProposalDiff.tsx"
import { Badge, Button } from "./primitives.tsx"

export function ProposalCard({
  proposal,
  eligible,
  busy,
  onApply,
  onReject,
}: {
  readonly proposal: ChartProposal
  readonly eligible: boolean
  readonly busy: string | null
  readonly onApply: () => void
  readonly onReject: () => void
}) {
  const source = proposal.source === "agent" ? "Agent" : "Native generation"
  const runScope = proposal.run_id === undefined ? "no agent run" : `run ${proposal.run_id}`
  return (
    <article className="proposal">
      <div className="proposal__head">
        <div>
          <span className="proposal__eyebrow">Human review required</span>
          <strong>Proposed document change</strong>
        </div>
        <Badge tone={eligible ? "warning" : "stale"}>{eligible ? "Uncertified" : "Stale"}</Badge>
      </div>
      <p className="mono proposal__scope">
        BASE R{proposal.base_revision} · {source} · {runScope}
      </p>
      <div className="proposal__summary">
        <span>Model summary · non-authoritative</span>
        <p>{proposal.summary}</p>
      </div>
      <ProposalDiff proposal={proposal} />
      {!eligible && (
        <p className="proposal__warning">
          <AlertTriangle size={13} /> This proposal targets an earlier saved revision. Save and run
          the task again.
        </p>
      )}
      <div className="cluster">
        <Button
          variant="primary"
          icon={<Check size={13} />}
          disabled={!eligible || busy !== null}
          onClick={onApply}
        >
          {busy === `apply-${proposal.id}` ? "Applying" : "Apply changes"}
        </Button>
        <Button variant="ghost" icon={<X size={13} />} disabled={busy !== null} onClick={onReject}>
          {busy === `discard-${proposal.id}` ? "Rejecting" : "Reject"}
        </Button>
      </div>
    </article>
  )
}
