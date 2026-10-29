import { useCallback, useEffect, useMemo, useState } from "react"
import { compareBeats } from "../../shared/beat.ts"
import type { Beat, BeatNote, BeatTiming, UcsMode } from "../../shared/index.ts"
import {
  beatAtTimelineRow,
  formatBeat,
  laneTone,
  timelineRowAtBeat,
  timelineRowPositionAtBeatNumber,
} from "../domain/beat-timeline.ts"
import { audioMicrosToBeatPosition } from "../domain/beat-timing.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { laneLabels } from "./studio-types.ts"
import { TimelineControls } from "./TimelineControls.tsx"
import { TimelinePlayhead } from "./TimelinePlayhead.tsx"
import { type TimelineRegion, TimelineRows } from "./TimelineRows.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"
import { usePlaybackSnapshot } from "./useAudioPlayback.ts"
import { useTimelineGesture } from "./useTimelineGesture.ts"
import { useTimelineVirtualScroll } from "./useTimelineVirtualScroll.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const singleLaneIndices = [0, 1, 2, 3, 4] as const
const zero = { numerator: 0, denominator: 1 } as const satisfies Beat

export type TimelineProps = {
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
  readonly onToggleTap: (at: Beat, lane: PanelIndex) => void
  readonly onPlaceHold: (head: Beat, tail: Beat, lane: PanelIndex) => void
  readonly onRowsPerMeasureChange: (at: Beat, rowsPerMeasure: number) => void
  readonly automaticRegions?: readonly TimelineRegion[]
  readonly regionsReadOnly?: boolean
  readonly readOnly?: boolean
  readonly anchorBeat?: Beat
}

export function Timeline(props: TimelineProps) {
  const lanes: readonly PanelIndex[] = props.mode === "Single" ? singleLaneIndices : laneIndices
  const [followAudio, setFollowAudio] = useState(true)
  const [cursorRow, setCursorRow] = useState(0)
  const [cursorBeat, setCursorBeat] = useState(props.anchorBeat ?? zero)
  const [cursorLane, setCursorLane] = useState<PanelIndex>(0)
  const [keyboardHoldRows, setKeyboardHoldRows] = useState(1)
  const regions = props.automaticRegions ?? []
  const virtual = useTimelineVirtualScroll({
    timing: props.timing,
    anchorBeat: props.anchorBeat ?? zero,
  })
  const snapshot = usePlaybackSnapshot(props.playback)
  const activeRegion = regionAtBeat(
    regions,
    beatAtTimelineRow(props.timing, Math.max(0, Math.floor(virtual.virtualWindow.visibleRow))),
  )

  const isReadOnly = useCallback(
    (at: Beat) =>
      props.readOnly === true ||
      (props.regionsReadOnly === true && regionAtBeat(regions, at) !== undefined),
    [props.readOnly, props.regionsReadOnly, regions],
  )
  const isRangeReadOnly = useCallback(
    (first: Beat, last: Beat) => {
      if (props.readOnly === true) return true
      if (props.regionsReadOnly !== true) return false
      const head = compareBeats(first, last) <= 0 ? first : last
      const tail = compareBeats(first, last) <= 0 ? last : first
      return regions.some(
        (region) => compareBeats(region.start, tail) <= 0 && compareBeats(region.end, head) > 0,
      )
    },
    [props.readOnly, props.regionsReadOnly, regions],
  )
  const gesture = useTimelineGesture({
    onToggle: props.onToggleTap,
    onHold: props.onPlaceHold,
    isReadOnly,
    isRangeReadOnly,
  })

  useEffect(() => {
    if (!followAudio || !showsPlaybackClock(snapshot.status)) return
    const beatPosition = audioMicrosToBeatPosition(props.timing, snapshot.audioMicros)
    if (beatPosition !== null)
      virtual.followRow(timelineRowPositionAtBeatNumber(props.timing, beatPosition))
  }, [followAudio, props.timing, snapshot.audioMicros, snapshot.status, virtual.followRow])

  const focusCell = useCallback((row: number, beat: Beat, lane: PanelIndex) => {
    setFollowAudio(false)
    setCursorRow(row)
    setCursorBeat(beat)
    setCursorLane(lane)
  }, [])

  const moveCursor = useCallback(
    (rowDelta: number, laneDelta: number) => {
      const maximumRow =
        props.timing.duration === null
          ? Number.POSITIVE_INFINITY
          : virtualRowForDuration(props.timing)
      const nextRow = Math.min(Math.max(cursorRow + rowDelta, 0), maximumRow)
      const laneIndex = Math.min(
        Math.max(lanes.indexOf(cursorLane) + laneDelta, 0),
        lanes.length - 1,
      )
      const nextLane = lanes[laneIndex]
      if (nextLane === undefined) return
      const nextBeat = beatAtTimelineRow(props.timing, nextRow)
      setCursorRow(nextRow)
      setCursorBeat(nextBeat)
      setCursorLane(nextLane)
      virtual.revealBeat(nextBeat)
    },
    [cursorLane, cursorRow, lanes, props.timing, virtual.revealBeat],
  )

  const keyboardHold = useCallback(
    (row: number, lane: PanelIndex) => {
      const head = beatAtTimelineRow(props.timing, row)
      const tail = beatAtTimelineRow(props.timing, row + keyboardHoldRows)
      if (!isRangeReadOnly(head, tail)) props.onPlaceHold(head, tail, lane)
    },
    [isRangeReadOnly, keyboardHoldRows, props.onPlaceHold, props.timing],
  )

  const measureRows = rowsPerMeasureAtBeat(props.timing, cursorBeat)
  const headerLabels = useMemo(() => lanes.map((lane) => laneLabels[lane]), [lanes])
  return (
    <section
      className={`timeline timeline--${props.mode.toLowerCase()}`}
      id="chart-editor"
      aria-label={`${lanes.length}-lane ${props.mode} beat chart editor`}
    >
      <TimelineControls
        timing={props.timing}
        mode={props.mode}
        playback={props.playback}
        cursorBeat={cursorBeat}
        keyboardHoldRows={keyboardHoldRows}
        onKeyboardHoldRows={setKeyboardHoldRows}
        onRowsPerMeasureChange={props.onRowsPerMeasureChange}
        onPreviousMeasure={() => moveCursor(-measureRows, 0)}
        onNextMeasure={() => moveCursor(measureRows, 0)}
        followAudio={followAudio}
        setFollowAudio={setFollowAudio}
      />
      <section
        className="timeline__scroller"
        aria-label="Scrollable beat chart lanes"
        ref={virtual.scrollerRef}
        onScroll={virtual.onScroll}
        onWheel={() => setFollowAudio(false)}
        {...gesture}
      >
        <div className="timeline__header" aria-hidden="true">
          <span>Beat</span>
          <span>Tempo</span>
          {headerLabels.map((label, index) => (
            <span data-tone={laneTone(lanes[index] ?? 0)} key={label}>
              {label}
            </span>
          ))}
        </div>
        {activeRegion === undefined ? null : (
          <div className="timeline__active-region">
            <span>{activeRegion.name} · automatic</span>
          </div>
        )}
        <TimelinePlayhead />
        <div className="timeline__rows" style={{ blockSize: virtual.runwaySize }}>
          <div
            className="timeline__virtual-window"
            style={{ transform: `translateY(${virtual.virtualWindow.offset}px)` }}
          >
            <TimelineRows
              rows={virtual.virtualWindow.rows}
              notes={props.notes}
              timing={props.timing}
              lanes={lanes}
              rowSize={virtual.rowSize}
              cursorRow={cursorRow}
              cursorLane={cursorLane}
              regions={regions}
              regionsReadOnly={props.regionsReadOnly === true}
              readOnly={props.readOnly === true}
              onFocusCell={focusCell}
              onToggle={props.onToggleTap}
              onKeyboardHold={keyboardHold}
              onMoveCursor={moveCursor}
            />
          </div>
        </div>
        <details className="note-list">
          <summary>Structured note list ({props.notes.length})</summary>
          <ol>
            {props.notes.map((note) => (
              <li
                className="mono"
                key={`${formatBeat(note.at)}:${note.panel_mask}:${formatBeat(note.hold)}`}
              >
                Beat {formatBeat(note.at)}, mask {note.panel_mask}, hold {formatBeat(note.hold)}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </section>
  )
}

function regionAtBeat(regions: readonly TimelineRegion[], at: Beat): TimelineRegion | undefined {
  return regions.find(
    (region) => compareBeats(region.start, at) <= 0 && compareBeats(at, region.end) < 0,
  )
}

function rowsPerMeasureAtBeat(timing: BeatTiming, at: Beat): number {
  let rows = timing.grid_sections[0]?.rows_per_measure ?? 1
  for (const section of timing.grid_sections) {
    if (compareBeats(section.at, at) > 0) break
    rows = section.rows_per_measure
  }
  return rows
}

function virtualRowForDuration(timing: BeatTiming): number {
  return timing.duration === null
    ? Number.POSITIVE_INFINITY
    : timelineRowAtBeat(timing, timing.duration)
}
