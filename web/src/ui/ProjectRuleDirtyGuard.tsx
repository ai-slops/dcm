import { useEffect, useRef } from "react"

import { Button } from "./primitives.tsx"

type ProjectRuleDirtyGuardProps = {
  readonly onDiscard: () => void
  readonly onCancel: () => void
}

export function ProjectRuleDirtyGuard(props: ProjectRuleDirtyGuardProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div className="library-dirty-guard" role="alertdialog" aria-label="Unsaved project rules">
      <strong>Unsaved project rule changes</strong>
      <p>Discard the visible rule edits before changing projects, or cancel this action.</p>
      <div className="cluster">
        <Button variant="danger" onClick={props.onDiscard}>
          Discard changes
        </Button>
        <button
          ref={cancelRef}
          type="button"
          className="button button--secondary"
          data-initial-focus="true"
          onClick={props.onCancel}
        >
          <span>Cancel</span>
        </button>
      </div>
    </div>
  )
}
