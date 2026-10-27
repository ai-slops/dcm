import type { Bootstrap, ChartProposal, Revision } from "../../shared/index.ts"
import { AgentPanel } from "./AgentPanel.tsx"
import type { MobileTab } from "./MobileTabs.tsx"

type StudioAgentAsideProps = {
  readonly tab: MobileTab
  readonly bootstrap: Bootstrap
  readonly dirty: boolean
  readonly revision: Revision
  readonly proposals: readonly ChartProposal[]
  readonly onProposal: (proposal: ChartProposal) => void
  readonly onBootstrap: (bootstrap: Bootstrap) => void
  readonly runtimeError: string | undefined
  readonly apply: (proposal: ChartProposal) => Promise<void>
  readonly discard: (proposal: ChartProposal) => Promise<void>
}

export function StudioAgentAside(props: StudioAgentAsideProps) {
  return (
    <aside
      className={`agent-rail mobile-${props.tab}`}
      id="agent-panel"
      role="tabpanel"
      aria-labelledby="agent-tab"
      tabIndex={-1}
    >
      <AgentPanel
        bootstrap={props.bootstrap}
        dirty={props.dirty}
        revision={props.revision}
        proposals={props.proposals}
        onProposal={props.onProposal}
        onBootstrap={props.onBootstrap}
        apply={props.apply}
        discard={props.discard}
        {...(props.runtimeError === undefined ? {} : { runtimeError: props.runtimeError })}
      />
    </aside>
  )
}
