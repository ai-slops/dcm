import { AlertTriangle, Check, X } from "lucide-react"

import type { ChartProposal } from "../../shared/index.ts"
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
  const changes = proposal.changes
  return (
    <article className="proposal">
      <div className="proposal__head">
        <div>
          <span className="proposal__eyebrow">Human review required</span>
          <strong>{proposal.summary}</strong>
        </div>
        <Badge tone={eligible ? "warning" : "stale"}>{eligible ? "Uncertified" : "Stale"}</Badge>
      </div>
      {changes === undefined ? (
        <p className="mono">
          BASE R{proposal.base_revision} · {proposal.chart.notes.length} NOTES
        </p>
      ) : (
        <dl className="proposal__changes">
          <div>
            <dt>Notes</dt>
            <dd>
              +{changes.notes_added ?? 0} / -{changes.notes_removed ?? 0}
            </dd>
          </div>
          <div>
            <dt>Timing</dt>
            <dd>{changes.timing_changed === true ? "Changed" : "Unchanged"}</dd>
          </div>
          <div>
            <dt>Ticks</dt>
            <dd>
              {changes.tick_start ?? "-"}–{changes.tick_end ?? "-"}
            </dd>
          </div>
          <div>
            <dt>Lanes</dt>
            <dd>{changes.lanes?.join(", ") ?? "-"}</dd>
          </div>
        </dl>
      )}
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
