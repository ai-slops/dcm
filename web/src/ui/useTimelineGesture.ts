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
  readonly beatAtClientY: (clientY: number) => Beat
}

type ActiveGesture = {
  readonly pointerId: number
  readonly start: Beat
  readonly startClientY: number
  readonly lane: PanelIndex
  end: Beat
  dragged: boolean
}

const pointerJitterThreshold = 4

export function useTimelineGesture(input: TimelineGestureInput) {
  const active = useRef<ActiveGesture | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const cell = timelineCell(event.target, event.clientY, true, input.beatAtClientY)
      if (cell === null || input.isReadOnly(cell.at)) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      active.current = {
        pointerId: event.pointerId,
        start: cell.at,
        startClientY: event.clientY,
        end: cell.at,
        lane: cell.lane,
        dragged: false,
      }
    },
    [input],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      gesture.dragged ||= timelineGestureExceedsJitter(gesture.startClientY, event.clientY)
      if (!gesture.dragged) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const edgeSize = Number.parseFloat(
        getComputedStyle(event.currentTarget).getPropertyValue("--timeline-row-size"),
      )
      if (Number.isFinite(edgeSize) && event.clientY < bounds.top + edgeSize)
        event.currentTarget.scrollTop -= edgeSize
      else if (Number.isFinite(edgeSize) && event.clientY > bounds.bottom - edgeSize)
        event.currentTarget.scrollTop += edgeSize
      const cell = timelineCell(
        document.elementFromPoint(event.clientX, event.clientY),
        event.clientY,
        false,
        input.beatAtClientY,
      )
      if (cell !== null) gesture.end = cell.at
    },
    [input.beatAtClientY],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      active.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (!gesture.dragged || sameBeat(gesture.start, gesture.end))
        input.onToggle(gesture.start, gesture.lane)
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

export function timelineGestureExceedsJitter(startClientY: number, clientY: number): boolean {
  return Math.abs(clientY - startClientY) > pointerJitterThreshold
}

function timelineCell(
  target: EventTarget | null,
  clientY: number,
  preserveExactBeat: boolean,
  beatAtClientY: (clientY: number) => Beat,
): { readonly at: Beat; readonly lane: PanelIndex } | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest<HTMLElement>(
    ":is(.timeline__cell, .timeline__exact-note, .timeline__lane-surface)[data-lane]",
  )
  if (cell === null) return null
  const lane = panelIndex(Number(cell.getAttribute("data-lane")))
  if (lane === null) return null
  if (!preserveExactBeat || !cell.classList.contains("timeline__exact-note"))
    return { at: beatAtClientY(clientY), lane }
  const numerator = Number(cell.getAttribute("data-beat-numerator"))
  const denominator = Number(cell.getAttribute("data-beat-denominator"))
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0)
    return null
  return { at: { numerator, denominator }, lane }
}

function sameBeat(left: Beat, right: Beat): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator
}
