import { useEffect, useRef } from "react"

import { Button } from "./primitives.tsx"

type LibraryDirtyGuardProps = {
  readonly busy: boolean
  readonly onSave: () => void
  readonly onDiscard: () => void
  readonly onCancel: () => void
}

export function LibraryDirtyGuard(props: LibraryDirtyGuardProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div className="library-dirty-guard" role="alertdialog" aria-label="Unsaved changes">
      <strong>Unsaved chart changes</strong>
      <p>Save the current chart, discard its changes, or cancel this library action.</p>
      <div className="cluster">
        <Button variant="primary" disabled={props.busy} onClick={props.onSave}>
          Save and continue
        </Button>
        <Button disabled={props.busy} onClick={props.onDiscard}>
          Discard changes
        </Button>
        <button
          ref={cancelRef}
          type="button"
          className="button button--secondary"
          data-initial-focus="true"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          <span>Cancel</span>
        </button>
      </div>
    </div>
  )
}
