import { type PropsWithChildren, useEffect, useId, useRef } from "react"

import { Button } from "./primitives.tsx"

type ActionDialogProps = PropsWithChildren<{
  readonly busy: boolean
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
}>

export function ActionDialog({ busy, children, open, title, onClose }: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return
    const returnFocus = document.activeElement
    if (!dialog.open) dialog.showModal()
    titleRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (returnFocus instanceof HTMLElement) returnFocus.focus()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="action-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="action-dialog__head">
        <h2 ref={titleRef} id={titleId} tabIndex={-1}>
          {title}
        </h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      {children}
    </dialog>
  )
}
