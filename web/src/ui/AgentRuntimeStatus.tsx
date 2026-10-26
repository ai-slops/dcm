import { AlertTriangle, CheckCircle2, Server, Wrench } from "lucide-react"

import type { AgentProviderStatus, Bootstrap } from "../../shared/index.ts"
import { Badge } from "./primitives.tsx"

export type AgentToolAvailability = NonNullable<Bootstrap["tools"]>[number]

export function AgentRuntimeStatus({
  agent,
  tools = [],
}: {
  readonly agent: AgentProviderStatus
  readonly tools: Bootstrap["tools"]
}) {
  const ready = agent.configured && agent.model !== null
  return (
    <section className="agent-runtime" aria-label="Part agent runtime">
      <div className="agent-runtime__headline">
        <div>
          <strong>Part runtime</strong>
          <span>{agent.runtime ?? "Version unavailable"}</span>
        </div>
        <Badge tone={ready ? "success" : "warning"}>
          {ready ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {ready ? "Ready" : "Setup needed"}
        </Badge>
      </div>
      <dl className="agent-runtime__facts">
        <div>
          <dt>Source</dt>
          <dd>
            <Server size={12} /> {agent.source ?? "off"}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{agent.model ?? "Choose a model"}</dd>
        </div>
        <div>
          <dt>API</dt>
          <dd>{agent.api ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Catalog</dt>
          <dd>{agent.models?.length ?? 0} models</dd>
        </div>
      </dl>
      {agent.message !== undefined && <p className="agent-runtime__message">{agent.message}</p>}
      {tools.length > 0 && (
        <section className="agent-tools" aria-label="Agent tools">
          {tools.map((tool) => (
            <span
              className={`agent-tool agent-tool--${tool.available ? "available" : "unavailable"}`}
              key={tool.id}
              title={tool.reason}
            >
              <Wrench size={11} />
              {tool.id}
              <span>{tool.available ? "available" : "unavailable"}</span>
            </span>
          ))}
        </section>
      )}
    </section>
  )
}
