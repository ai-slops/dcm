import { Bot, RefreshCw, Square } from "lucide-react"
import { useState } from "react"

import type { Bootstrap, ChartProposal, Revision } from "../../shared/index.ts"
import { canApplyProposal } from "../domain/editor.ts"
import { errorMessage } from "./action-utils.ts"
import { Badge, Button, Panel } from "./primitives.tsx"
import { useAgentRun } from "./useAgentRun.ts"

type AgentPanelProps = {
  readonly bootstrap: Bootstrap
  readonly dirty: boolean
  readonly revision: Revision
  readonly proposals: readonly ChartProposal[]
  readonly onProposal: (proposal: ChartProposal) => void
  readonly apply: (proposal: ChartProposal) => Promise<void>
  readonly discard: (proposal: ChartProposal) => Promise<void>
}

export function AgentPanel(props: AgentPanelProps) {
  const [prompt, setPrompt] = useState("")
  const controller = useAgentRun(props.bootstrap, props.revision, props.onProposal)
  const [proposalBusy, setProposalBusy] = useState<string | null>(null)
  const interactionBusy = controller.busy !== null || proposalBusy !== null

  async function changeProposal(action: "apply" | "discard", proposal: ChartProposal) {
    if (interactionBusy) return
    setProposalBusy(`${action}-${proposal.id}`)
    controller.setActionError("")
    try {
      await (action === "apply" ? props.apply(proposal) : props.discard(proposal))
    } catch (error) {
      controller.setActionError(
        `${action === "apply" ? "Apply" : "Discard"} failed. ${errorMessage(error)}`,
      )
    } finally {
      setProposalBusy(null)
    }
  }

  return (
    <Panel
      title="Agent"
      action={
        <Badge tone={props.bootstrap.agent.configured ? "success" : "warning"}>
          {props.bootstrap.agent.configured ? props.bootstrap.agent.provider : "Not configured"}
        </Badge>
      }
      className="agent-panel"
    >
      <div className="agent-stream" aria-live="polite">
        {controller.run !== null && (
          <p className="mono agent-run-status">Run {controller.run.status}</p>
        )}
        {controller.activity.map((item) => (
          <p className={`agent-event agent-event--${item.kind}`} key={item.key}>
            {item.text}
          </p>
        ))}
        {controller.disconnected && (
          <Button
            icon={<RefreshCw size={13} />}
            disabled={controller.busy !== null}
            onClick={controller.reconnect}
          >
            Reconnect
          </Button>
        )}
        {props.proposals.map((proposal) => {
          const eligible = canApplyProposal({
            dirty: props.dirty,
            currentRevision: props.revision,
            baseRevision: proposal.base_revision,
          })
          return (
            <article className="proposal" key={proposal.id}>
              <div className="proposal__head">
                <strong>{proposal.summary}</strong>
                <Badge tone={eligible ? "info" : "stale"}>
                  {eligible ? proposal.source : "Stale"}
                </Badge>
              </div>
              <p className="mono">
                BASE R{proposal.base_revision} · {proposal.chart.notes.length} NOTES
              </p>
              <div className="cluster">
                <Button
                  variant="primary"
                  disabled={!eligible || interactionBusy}
                  onClick={() => void changeProposal("apply", proposal)}
                >
                  {proposalBusy === `apply-${proposal.id}` ? "Applying" : "Apply"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={interactionBusy}
                  onClick={() => void changeProposal("discard", proposal)}
                >
                  {proposalBusy === `discard-${proposal.id}` ? "Discarding" : "Discard"}
                </Button>
              </div>
            </article>
          )
        })}
        {props.proposals.length === 0 && controller.activity.length === 0 && (
          <div className="agent-empty">
            <Bot size={24} />
            <p>No agent activity yet. Configure a provider or ask for a scoped chart change.</p>
          </div>
        )}
      </div>
      <div className="composer">
        {controller.actionError !== "" && (
          <p className="field-error" role="alert">
            {controller.actionError}
          </p>
        )}
        <textarea
          aria-label="Agent instruction"
          value={prompt}
          disabled={
            !props.bootstrap.agent.configured || controller.running || controller.busy !== null
          }
          placeholder={
            props.bootstrap.agent.configured
              ? "Describe a scoped chart change"
              : "Configure on the server to enable agent runs"
          }
          onChange={(event) => setPrompt(event.target.value)}
        />
        {props.dirty && (
          <span className="status-copy">Save the draft before starting an agent run.</span>
        )}
        {controller.running ? (
          <Button
            variant="danger"
            icon={<Square size={13} />}
            disabled={controller.busy !== null}
            onClick={() => void controller.cancel()}
          >
            {controller.busy === "cancel" ? "Cancelling" : "Cancel"}
          </Button>
        ) : (
          <Button
            disabled={
              !props.bootstrap.agent.configured ||
              props.dirty ||
              prompt.trim() === "" ||
              controller.busy !== null
            }
            onClick={() =>
              void controller.start(prompt).then((started) => {
                if (started) setPrompt("")
              })
            }
          >
            {controller.busy === "start" ? "Sending" : "Send"}
          </Button>
        )}
      </div>
    </Panel>
  )
}
