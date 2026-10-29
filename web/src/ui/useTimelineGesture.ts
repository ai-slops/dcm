import type { PointerEvent as ReactPointerEvent } from "react"
import { useCallback, useRef } from "react"

import type { Beat } from "../../shared/beat.ts"
import { panelIndex } from "../domain/beat-timeline.ts"
import type { PanelIndex } from "../domain/editor.ts"

type TimelineGestureInput = {
  readonly onToggle: (at: Beat, lane: PanelIndex) => void
  readonly onHold: (head: Beat, tail: Beat, lane: PanelIndex) => void
  readonly isReadOnly: (at: Beat) => boolean
  readonly isRangeReadOnly: (head: Beat, tail: Beat) => boolean
}

type ActiveGesture = {
  readonly pointerId: number
  readonly start: Beat
  readonly lane: PanelIndex
  end: Beat
}

export function useTimelineGesture(input: TimelineGestureInput) {
  const active = useRef<ActiveGesture | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const cell = timelineCell(event.target)
      if (cell === null || input.isReadOnly(cell.at)) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      active.current = { pointerId: event.pointerId, start: cell.at, end: cell.at, lane: cell.lane }
    },
    [input],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = active.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientY < bounds.top + 44) event.currentTarget.scrollTop -= 12
    else if (event.clientY > bounds.bottom - 44) event.currentTarget.scrollTop += 12
    const cell = timelineCell(document.elementFromPoint(event.clientX, event.clientY))
    if (cell !== null) gesture.end = cell.at
  }, [])

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      active.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (sameBeat(gesture.start, gesture.end)) input.onToggle(gesture.start, gesture.lane)
      else if (!input.isRangeReadOnly(gesture.start, gesture.end))
        input.onHold(gesture.start, gesture.end, gesture.lane)
    },
    [input],
  )

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (active.current?.pointerId === event.pointerId) active.current = null
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

function timelineCell(
  target: EventTarget | null,
): { readonly at: Beat; readonly lane: PanelIndex } | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest<HTMLButtonElement>(
    ".timeline__cell[data-beat-numerator][data-beat-denominator][data-lane]",
  )
  if (cell === null) return null
  const numerator = Number(cell.getAttribute("data-beat-numerator"))
  const denominator = Number(cell.getAttribute("data-beat-denominator"))
  const lane = panelIndex(Number(cell.getAttribute("data-lane")))
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    lane === null
  )
    return null
  return { at: { numerator, denominator }, lane }
}

function sameBeat(left: Beat, right: Beat): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator
}
