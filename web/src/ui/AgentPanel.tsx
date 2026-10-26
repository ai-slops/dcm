import { RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"

import type { AgentRunSnapshot, Bootstrap, ChartProposal, Revision } from "../../shared/index.ts"
import { canApplyProposal } from "../domain/editor.ts"
import { AgentComposer } from "./AgentComposer.tsx"
import { AgentRuntimeStatus } from "./AgentRuntimeStatus.tsx"
import { errorMessage } from "./action-utils.ts"
import type { AgentActivity } from "./agent-run-state.ts"
import { initialModelId } from "./agent-run-state.ts"
import { ProposalCard } from "./ProposalCard.tsx"
import { ProposalDecisionHistory } from "./ProposalDecisionHistory.tsx"
import { Button, Panel } from "./primitives.tsx"
import { RunResult } from "./RunResult.tsx"
import { ToolCallCard } from "./ToolCallCard.tsx"
import { useAgentRun } from "./useAgentRun.ts"

type AgentPanelProps = {
  readonly bootstrap: Bootstrap
  readonly dirty: boolean
  readonly revision: Revision
  readonly proposals: readonly ChartProposal[]
  readonly onProposal: (proposal: ChartProposal) => void
  readonly onBootstrap: (bootstrap: Bootstrap) => void
  readonly runtimeError?: string
  readonly apply: (proposal: ChartProposal) => Promise<void>
  readonly discard: (proposal: ChartProposal) => Promise<void>
}

function ActivityItem({
  item,
  status,
}: {
  readonly item: AgentActivity
  readonly status: AgentRunSnapshot["status"] | null
}) {
  switch (item.kind) {
    case "prompt":
      return <p className="agent-event agent-event--prompt">{item.text}</p>
    case "event":
      return <p className="agent-event agent-event--event">{item.text}</p>
    case "assistant":
      return <RunResult text={item.text} status={status ?? "running"} truncated={item.truncated} />
    case "tool":
      return <ToolCallCard call={item.call} />
  }
}

export function AgentPanel(props: AgentPanelProps) {
  const [prompt, setPrompt] = useState("")
  const [modelId, setModelId] = useState(() => initialModelId(props.bootstrap.agent))
  const controller = useAgentRun(
    props.bootstrap,
    props.revision,
    props.onProposal,
    props.onBootstrap,
  )
  const [proposalBusy, setProposalBusy] = useState<string | null>(null)
  const interactionBusy = controller.busy !== null || proposalBusy !== null
  const actionError =
    controller.actionError ||
    (props.runtimeError
      ? `${props.runtimeError}. Displayed readiness may be stale; reload to retry.`
      : "")

  useEffect(() => {
    setModelId((current) => {
      if (props.bootstrap.agent.models?.some((model) => model.id === current)) return current
      return initialModelId(props.bootstrap.agent)
    })
  }, [props.bootstrap.agent])

  async function changeProposal(action: "apply" | "discard", proposal: ChartProposal) {
    if (interactionBusy) return
    setProposalBusy(`${action}-${proposal.id}`)
    controller.setActionError("")
    try {
      await (action === "apply" ? props.apply(proposal) : props.discard(proposal))
      await controller.refreshSnapshot(proposal.run_id)
    } catch (error) {
      controller.setActionError(
        `${action === "apply" ? "Apply" : "Reject"} failed. ${errorMessage(error)}`,
      )
    } finally {
      setProposalBusy(null)
    }
  }

  return (
    <Panel title="Agent" className="agent-panel">
      <div className="agent-stream" aria-live="polite">
        <AgentRuntimeStatus agent={props.bootstrap.agent} tools={props.bootstrap.tools} />
        {controller.run !== null && (
          <p className="mono agent-run-status">
            Run {controller.run.status}
            {controller.run.model === undefined ? "" : ` · ${controller.run.model}`}
            {controller.run.api === undefined || controller.run.api === null
              ? ""
              : ` · ${controller.run.api}`}
          </p>
        )}
        {controller.activity.map((item) => (
          <ActivityItem item={item} status={controller.run?.status ?? null} key={item.key} />
        ))}
        <ProposalDecisionHistory decisions={controller.decisions} />
        {controller.disconnected && (
          <div className="agent-recovery">
            <p>
              Connection lost. The saved run snapshot is retained; reconnecting will not submit it
              again.
            </p>
            <Button
              icon={<RefreshCw size={13} />}
              disabled={controller.busy !== null}
              onClick={controller.reconnect}
            >
              Reconnect stream
            </Button>
          </div>
        )}
        {props.proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            eligible={canApplyProposal({
              dirty: props.dirty,
              currentRevision: props.revision,
              baseRevision: proposal.base_revision,
            })}
            busy={proposalBusy}
            onApply={() => void changeProposal("apply", proposal)}
            onReject={() => void changeProposal("discard", proposal)}
          />
        ))}
      </div>
      {actionError !== "" && (
        <p className="field-error agent-action-error" role="alert">
          {actionError}
        </p>
      )}
      <AgentComposer
        agent={props.bootstrap.agent}
        prompt={prompt}
        modelId={modelId}
        dirty={props.dirty}
        running={controller.running}
        busy={controller.busy}
        onPrompt={setPrompt}
        onModel={setModelId}
        onCancel={() => void controller.cancel()}
        onStart={() =>
          void controller.start(prompt, modelId).then((started) => {
            if (started) setPrompt("")
          })
        }
      />
    </Panel>
  )
}
