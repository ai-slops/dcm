import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react"

import type { AgentToolCall } from "./agent-run-state.ts"
import { Badge } from "./primitives.tsx"

function ToolState({ state }: { readonly state: AgentToolCall["state"] }) {
  switch (state) {
    case "started":
      return (
        <>
          <LoaderCircle size={12} /> Running
        </>
      )
    case "completed":
      return (
        <>
          <CheckCircle2 size={12} /> Completed
        </>
      )
    case "failed":
      return (
        <>
          <AlertCircle size={12} /> Failed
        </>
      )
  }
}

export function ToolCallCard({ call }: { readonly call: AgentToolCall }) {
  return (
    <article className={`tool-call tool-call--${call.state}`}>
      <header>
        <strong>{call.tool_id}</strong>
        <Badge
          tone={call.state === "failed" ? "error" : call.state === "completed" ? "success" : "info"}
        >
          <ToolState state={call.state} />
        </Badge>
      </header>
      {call.input_preview !== "" && (
        <details>
          <summary>Input</summary>
          <pre>{call.input_preview}</pre>
        </details>
      )}
      {call.output_preview !== undefined && (
        <details open={call.state === "completed"}>
          <summary>Result{call.truncated === true ? " · truncated" : ""}</summary>
          <pre>{call.output_preview}</pre>
        </details>
      )}
      {call.error !== undefined && (
        <p className="tool-call__error">
          <strong>{call.error.code}</strong> {call.error.message}
        </p>
      )}
    </article>
  )
}
