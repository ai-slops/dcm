import { Send, Square } from "lucide-react"

import type { AgentProviderStatus } from "../../shared/index.ts"
import { Button } from "./primitives.tsx"

export const suggestedAgentTasks = [
  "Inspect saved chart and timing",
  "Evaluate the finite-model chart",
  "Propose a small tap or hold variation for review",
  "Validate Double UCS compatibility",
  "Propose a +25ms offset without applying it",
] as const

type AgentComposerProps = {
  readonly agent: AgentProviderStatus
  readonly prompt: string
  readonly modelId: string
  readonly dirty: boolean
  readonly running: boolean
  readonly busy: string | null
  readonly onPrompt: (prompt: string) => void
  readonly onModel: (modelId: string) => void
  readonly onStart: () => void
  readonly onCancel: () => void
}

export function AgentComposer(props: AgentComposerProps) {
  const modelReady = props.modelId !== ""
  const canStart =
    props.agent.configured && modelReady && !props.dirty && props.prompt.trim() !== ""
  return (
    <div className="composer">
      {!props.running && (
        <section className="agent-starters" aria-label="Suggested agent tasks">
          {suggestedAgentTasks.map((task) => (
            <button type="button" key={task} onClick={() => props.onPrompt(task)}>
              {task}
            </button>
          ))}
        </section>
      )}
      <label className="agent-model-field">
        <span>Model</span>
        <select
          value={props.modelId}
          disabled={!props.agent.configured || props.running || props.busy !== null}
          onChange={(event) => props.onModel(event.target.value)}
        >
          <option value="">Choose a catalog model</option>
          {(props.agent.models ?? []).map((model) => (
            <option value={model.id} key={model.id}>
              {model.name} · {model.api}
            </option>
          ))}
        </select>
        <small>
          Catalog API labels describe provider capability, not guaranteed chart-tool support.
        </small>
      </label>
      <textarea
        aria-label="Agent instruction"
        value={props.prompt}
        disabled={!props.agent.configured || props.running || props.busy !== null}
        placeholder={
          props.agent.configured ? "Describe a scoped chart task" : "Agent runtime is unavailable"
        }
        onChange={(event) => props.onPrompt(event.target.value)}
      />
      {props.dirty && (
        <span className="status-copy">Save the draft before starting an agent run.</span>
      )}
      {!modelReady && props.agent.configured && (
        <span className="status-copy">Choose a model from the provider catalog.</span>
      )}
      {props.running ? (
        <Button
          variant="danger"
          icon={<Square size={13} />}
          disabled={props.busy !== null}
          onClick={props.onCancel}
        >
          {props.busy === "cancel" ? "Cancelling" : "Cancel run"}
        </Button>
      ) : (
        <Button
          icon={<Send size={13} />}
          disabled={!canStart || props.busy !== null}
          onClick={props.onStart}
        >
          {props.busy === "start" ? "Starting" : "Run task"}
        </Button>
      )}
    </div>
  )
}
