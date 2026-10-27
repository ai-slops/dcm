import type { PointerEvent as ReactPointerEvent } from "react"
import { useCallback, useRef } from "react"

import type { PanelIndex } from "../domain/editor.ts"

type TimelineGestureInput = {
  readonly onCell: (tick: number, lane: PanelIndex) => void
  readonly onHold: ((startTick: number, endTick: number, lane: PanelIndex) => void) | undefined
  readonly isReadOnly: (tick: number) => boolean
  readonly isRangeReadOnly: (startTick: number, endTick: number) => boolean
}

type ActiveGesture = {
  readonly pointerId: number
  readonly startTick: number
  readonly lane: PanelIndex
  endTick: number
}

export function useTimelineGesture(input: TimelineGestureInput) {
  const active = useRef<ActiveGesture | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const cell = timelineCell(event.target)
      if (cell === null || input.isReadOnly(cell.tick)) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      active.current = {
        pointerId: event.pointerId,
        startTick: cell.tick,
        endTick: cell.tick,
        lane: cell.lane,
      }
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
    if (cell !== null) gesture.endTick = cell.tick
  }, [])

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      active.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (gesture.endTick === gesture.startTick || input.onHold === undefined)
        input.onCell(gesture.startTick, gesture.lane)
      else if (!input.isRangeReadOnly(gesture.startTick, gesture.endTick))
        input.onHold(gesture.startTick, gesture.endTick, gesture.lane)
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
): { readonly tick: number; readonly lane: PanelIndex } | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest<HTMLButtonElement>(".timeline__cell[data-tick][data-lane]")
  if (cell === null) return null
  const tick = Number(cell.getAttribute("data-tick"))
  const lane = Number(cell.getAttribute("data-lane"))
  const panel = panelIndex(lane)
  if (!Number.isInteger(tick) || panel === null) return null
  return { tick, lane: panel }
}

function panelIndex(value: number): PanelIndex | null {
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
      return value
    default:
      return null
  }
}
