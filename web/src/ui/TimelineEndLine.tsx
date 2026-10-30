import { useEffect, useRef, useState } from "react"

import type { Beat } from "../../shared/beat.ts"
import { formatBeat } from "../domain/beat-timeline.ts"
import { nudgeTimelineEnd } from "./timeline-editor-model.ts"

type TimelineEndLineProps = {
  readonly at: Beat
  readonly automatic: boolean
  readonly disabled: boolean
  readonly selectedSplit: number
  readonly error: string
  readonly positionY: number
  readonly beatAtClientY: (clientY: number) => Beat
  readonly positionYForBeat: (beat: Beat) => number
  readonly onChange: (at: Beat | null) => boolean
}

export function TimelineEndLine(props: TimelineEndLineProps) {
  const drag = useRef<{
    readonly pointerId: number
    readonly startY: number
    latestBeat: Beat
    moved: boolean
  } | null>(null)
  const [draft, setDraft] = useState(props.at)
  useEffect(() => setDraft(props.at), [props.at])
  return (
    <div
      className="timeline__end-line"
      data-automatic={props.automatic || undefined}
      style={{
        transform: `translateY(${drag.current === null ? props.positionY : props.positionYForBeat(draft)}px)`,
      }}
    >
      <button
        type="button"
        className="timeline__end-handle mono"
        disabled={props.disabled}
        aria-label={`${props.automatic ? "Set explicit end" : "Explicit chart end"} at beat ${formatBeat(draft)}`}
        aria-pressed={!props.automatic}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            latestBeat: props.at,
            moved: false,
          }
        }}
        onPointerMove={(event) => {
          const gesture = drag.current
          if (gesture?.pointerId !== event.pointerId) return
          gesture.moved ||= Math.abs(event.clientY - gesture.startY) > 2
          gesture.latestBeat = props.beatAtClientY(event.clientY)
          setDraft(gesture.latestBeat)
        }}
        onPointerUp={(event) => {
          const gesture = drag.current
          if (gesture?.pointerId !== event.pointerId) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          drag.current = null
          const next = gesture.moved ? gesture.latestBeat : props.at
          setDraft(props.onChange(next) ? next : props.at)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDraft(props.at)
        }}
        onClick={(event) => {
          if (event.detail === 0) {
            props.onChange(props.at)
            setDraft(props.at)
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          const next = nudgeTimelineEnd(
            props.at,
            props.selectedSplit,
            event.key === "ArrowDown" ? "later" : "earlier",
          )
          setDraft(props.onChange(next) ? next : props.at)
        }}
      >
        End
      </button>
      {props.automatic ? null : (
        <button
          type="button"
          className="timeline__automatic-end"
          aria-label="Use automatic"
          disabled={props.disabled}
          onClick={() => props.onChange(null)}
        >
          Auto
        </button>
      )}
      {props.error === "" ? null : (
        <p className="timeline__end-error field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  )
}
