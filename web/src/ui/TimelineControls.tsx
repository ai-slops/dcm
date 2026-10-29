import { useEffect, useState } from "react"

import { compareBeats } from "../../shared/beat.ts"
import {
  type Beat,
  type BeatTiming,
  MAX_EDIT_ROWS_PER_MEASURE,
  type UcsMode,
} from "../../shared/index.ts"
import { formatBeat } from "../domain/beat-timeline.ts"
import { TimelineClock } from "./TimelineClock.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

type TimelineControlsProps = {
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
  readonly cursorBeat: Beat
  readonly keyboardHoldRows: number
  readonly onKeyboardHoldRows: (rows: number) => void
  readonly onRowsPerMeasureChange: (at: Beat, rowsPerMeasure: number) => void
  readonly onPreviousMeasure: () => void
  readonly onNextMeasure: () => void
  readonly followAudio: boolean
  readonly setFollowAudio: (value: boolean) => void
}

export function TimelineControls(props: TimelineControlsProps) {
  const section = activeGridSection(props.timing, props.cursorBeat)
  return (
    <div className="timeline__controls">
      <SplitInput
        at={section.at}
        rowsPerMeasure={section.rows_per_measure}
        onCommit={props.onRowsPerMeasureChange}
      />
      <button type="button" onClick={props.onPreviousMeasure}>
        Previous measure
      </button>
      <output className="mono timeline__cursor-beat" aria-label="Keyboard cursor beat">
        Beat {formatBeat(props.cursorBeat)}
      </output>
      <button type="button" onClick={props.onNextMeasure}>
        Next measure
      </button>
      <label>
        Keyboard hold rows
        <input
          className="mono"
          min="1"
          max="512"
          type="number"
          value={props.keyboardHoldRows}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_EDIT_ROWS_PER_MEASURE)
              props.onKeyboardHoldRows(value)
          }}
        />
      </label>
      <span className="timeline__shortcut">Enter toggles · H places hold</span>
      <label className="timeline__follow">
        <input
          type="checkbox"
          checked={props.followAudio}
          onChange={(event) => props.setFollowAudio(event.currentTarget.checked)}
        />
        Follow audio
      </label>
      <span className="badge badge--info">
        {props.mode} · {props.mode === "Single" ? "5 lanes · left pad" : "10 lanes · two pads"}
      </span>
      <TimelineClock
        timing={props.timing}
        playback={props.playback}
        cursorBeat={props.cursorBeat}
      />
    </div>
  )
}

function SplitInput(props: {
  readonly at: Beat
  readonly rowsPerMeasure: number
  readonly onCommit: (at: Beat, rowsPerMeasure: number) => void
}) {
  const [draft, setDraft] = useState(String(props.rowsPerMeasure))
  useEffect(() => setDraft(String(props.rowsPerMeasure)), [props.rowsPerMeasure])
  function commit(): void {
    const value = Number(draft)
    if (Number.isSafeInteger(value) && value >= 1 && value <= 512) props.onCommit(props.at, value)
  }
  return (
    <label>
      Split (rows per measure)
      <input
        className="mono"
        aria-label="Split rows per four-beat measure"
        inputMode="numeric"
        max={MAX_EDIT_ROWS_PER_MEASURE}
        min="1"
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
        }}
      />
    </label>
  )
}

function activeGridSection(timing: BeatTiming, at: Beat): BeatTiming["grid_sections"][number] {
  let active = timing.grid_sections[0]
  if (active === undefined) throw new RangeError("Beat timing requires a grid section")
  for (const section of timing.grid_sections) {
    if (compareBeats(section.at, at) > 0) break
    active = section
  }
  return active
}
