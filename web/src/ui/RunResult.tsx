import { AlertCircle, CheckCircle2, CircleSlash2, LoaderCircle } from "lucide-react"

import type { AgentRunSnapshot } from "../../shared/index.ts"

type RunResultState = {
  readonly label: string
  readonly tone: "error" | "info" | "success" | "warning"
}

function resultState(status: AgentRunSnapshot["status"]): RunResultState {
  switch (status) {
    case "queued":
    case "running":
      return { label: "Partial response", tone: "info" }
    case "completed":
      return { label: "Run result", tone: "success" }
    case "cancelled":
      return { label: "Run cancelled", tone: "warning" }
    case "failed":
      return { label: "Run failed", tone: "error" }
  }
  const exhaustive: never = status
  return exhaustive
}

function ResultIcon({ tone }: { readonly tone: RunResultState["tone"] }) {
  switch (tone) {
    case "info":
      return <LoaderCircle size={14} />
    case "success":
      return <CheckCircle2 size={14} />
    case "warning":
      return <CircleSlash2 size={14} />
    case "error":
      return <AlertCircle size={14} />
  }
  const exhaustive: never = tone
  return exhaustive
}

export function RunResult({
  text,
  status,
  truncated,
}: {
  readonly text: string
  readonly status: AgentRunSnapshot["status"]
  readonly truncated: boolean
}) {
  const state = resultState(status)
  const statusColor = `var(--status-${state.tone})`
  return (
    <article
      className={`run-result run-result--${status}`}
      style={{ borderInlineStartColor: statusColor }}
    >
      <header style={{ color: statusColor }}>
        <ResultIcon tone={state.tone} />
        <strong>{state.label}</strong>
      </header>
      <p>{text}</p>
      {truncated && (
        <p className="run-result__truncation">
          Retained text is truncated. Earlier runtime text is no longer present in this snapshot.
        </p>
      )}
    </article>
  )
}
