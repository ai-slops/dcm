import { displaySeconds } from "@piu/chart-editor/glyphs"
import { useId } from "react"

import { type BeatTiming, MAX_EDIT_ROWS_PER_MEASURE, type UcsMode } from "../../shared/index.ts"
import { OffsetMillisecondsField } from "./OffsetMillisecondsField.tsx"
import { TimelineClock } from "./TimelineClock.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

type TimelineControlsProps = {
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
  readonly selectedSplit: number
  readonly pixelsPerSecond: number
  readonly lookaheadSeconds: number
  readonly error?: string
  readonly disabled: boolean
  readonly onSelectedSplitChange: (split: number) => void
  readonly onLookaheadChange: (seconds: number) => void
  readonly onTimingChange: (timing: BeatTiming) => void
}

export function TimelineControls(props: TimelineControlsProps) {
  const splitId = useId()
  const lookaheadId = useId()
  return (
    <div className="timeline__controls">
      <label htmlFor={splitId}>
        Split
        <input
          id={splitId}
          className="mono"
          aria-label="Split rows per beat"
          disabled={props.disabled}
          inputMode="numeric"
          max={MAX_EDIT_ROWS_PER_MEASURE / 4}
          min="1"
          type="number"
          value={props.selectedSplit}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (Number.isSafeInteger(value) && value >= 1 && value <= 128)
              props.onSelectedSplitChange(value)
          }}
        />
      </label>
      <label htmlFor={lookaheadId}>
        Lookahead
        <input
          id={lookaheadId}
          className="mono"
          aria-label="Editor lookahead seconds"
          max="12"
          min="0.1"
          step="0.05"
          type="number"
          value={props.lookaheadSeconds}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (isLookahead(value)) props.onLookaheadChange(value)
          }}
        />
        <span>seconds</span>
      </label>
      <label>
        Note spacing
        <input
          aria-label="Note display spacing"
          type="number"
          min="20"
          max="1000"
          step="1"
          value={Math.round(props.pixelsPerSecond)}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (Number.isFinite(value) && value >= 20 && value <= 1000) {
              const seconds = displaySeconds(props.pixelsPerSecond * props.lookaheadSeconds, value)
              props.onLookaheadChange(Math.max(0.1, Math.min(12, seconds)))
            }
          }}
        />
        <span>px / second</span>
      </label>
      <OffsetMillisecondsField
        offsetMicros={props.timing.offset_micros}
        disabled={props.disabled}
        onChange={(offsetMicros) =>
          props.onTimingChange({ ...props.timing, offset_micros: offsetMicros })
        }
      />
      <span className="badge badge--info">
        {props.mode} · {props.mode === "Single" ? "5 lanes · left pad" : "10 lanes · two pads"}
      </span>
      <TimelineClock timing={props.timing} playback={props.playback} />
      {props.error === undefined || props.error === "" ? null : (
        <p className="field-error timeline__error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  )
}

function isLookahead(value: number): boolean {
  if (!Number.isFinite(value) || value < 0.1 || value > 12) return false
  const steps = (value - 0.1) / 0.05
  return Math.abs(steps - Math.round(steps)) < 1e-9
}
