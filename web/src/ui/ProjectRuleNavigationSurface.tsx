import type { ReactNode } from "react"

import { ProjectRuleDirtyGuard } from "./ProjectRuleDirtyGuard.tsx"

type ProjectRuleNavigationSurfaceProps = {
  readonly children?: ReactNode
  readonly pending: boolean
  readonly onDiscard: () => void
  readonly onCancel: () => void
}

export function ProjectRuleNavigationSurface(props: ProjectRuleNavigationSurfaceProps) {
  return (
    <>
      {props.pending ? (
        <ProjectRuleDirtyGuard onDiscard={props.onDiscard} onCancel={props.onCancel} />
      ) : null}
      <div hidden={props.pending}>{props.children}</div>
    </>
  )
}
