import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import {
  buildVisibleCellIndex,
  TIMELINE_WINDOW_ROWS,
  timelineWindowStart,
} from "../domain/timeline.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { laneLabels } from "./studio-types.ts"
import { TimelineClock } from "./TimelineClock.tsx"
import { TimelinePlayhead } from "./TimelinePlayhead.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const quantizeOptions = [1, 2, 4, 8] as const

type TimelineProps = {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly ucsMode: UcsMode
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly selectedLane: PanelIndex
  readonly quantize: number
  readonly onQuantize: (ticks: number) => void
  readonly onCell: (tick: number, lane: PanelIndex) => void
  readonly onSelect: (tick: number, lane: PanelIndex) => void
}

export function Timeline(props: TimelineProps) {
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())
  const previousSelectedTick = useRef(props.selectedTick)
  const previousChart = useRef(props.chart)
  const cursorStart = windowStart(props.selectedTick, props)
  const [followAudio, setFollowAudio] = useState(true)
  const [manualStart, setManualStart] = useState(cursorStart)
  const start = usePlaybackWindowStart(props.playback, followAudio, manualStart, props)
  const pageTicks = TIMELINE_WINDOW_ROWS
  const ticks = useMemo(
    () =>
      Array.from({ length: TIMELINE_WINDOW_ROWS }, (_, index) => start + index).filter(
        (value) => value < props.chart.span_ticks,
      ),
    [props.chart.span_ticks, start],
  )
  const cells = useMemo(() => buildVisibleCellIndex(props.chart, start), [props.chart, start])

  useEffect(() => {
    if (!followAudio && previousSelectedTick.current !== props.selectedTick) {
      setManualStart(cursorStart)
    }
    previousSelectedTick.current = props.selectedTick
  }, [cursorStart, followAudio, props.selectedTick])

  useEffect(() => {
    if (previousChart.current !== props.chart) setManualStart(cursorStart)
    previousChart.current = props.chart
  }, [cursorStart, props.chart])

  function select(nextTick: number, nextLane: PanelIndex): void {
    setFollowAudio(false)
    setManualStart(windowStart(nextTick, props))
    props.onSelect(nextTick, nextLane)
  }

  function moveCursor(tickDelta: number, laneDelta: number): void {
    const nextTick = Math.min(
      Math.max(props.selectedTick + tickDelta, 0),
      props.chart.span_ticks - 1,
    )
    const nextLane = laneIndices[Math.min(Math.max(props.selectedLane + laneDelta, 0), 9)]
    if (nextLane === undefined) return
    select(nextTick, nextLane)
    requestAnimationFrame(() => cellRefs.current.get(`${nextTick}:${nextLane}`)?.focus())
  }

  return (
    <section className="timeline" id="chart-editor" aria-label="Ten-lane chart editor">
      <div className="timeline__controls">
        <label>
          Quantize
          <select
            value={props.quantize}
            onChange={(event) => {
              const nextQuantize = quantizeOptions[event.currentTarget.selectedIndex]
              if (nextQuantize !== undefined) props.onQuantize(nextQuantize)
            }}
          >
            {quantizeOptions
              .filter((step) => step <= props.chart.ticks_per_beat * 2)
              .map((step) => (
                <option key={step} value={step}>
                  {step} tick{step === 1 ? "" : "s"}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => select(Math.max(0, start - pageTicks), props.selectedLane)}
        >
          Previous
        </button>
        <label>
          Go to tick
          <input
            className="mono"
            min="0"
            max={props.chart.span_ticks - 1}
            type="number"
            value={props.selectedTick}
            onChange={(event) => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                select(event.currentTarget.valueAsNumber, props.selectedLane)
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            select(Math.min(props.chart.span_ticks - 1, start + pageTicks), props.selectedLane)
          }
        >
          Next
        </button>
        <label className="timeline__follow">
          <input
            type="checkbox"
            checked={followAudio}
            onChange={(event) => {
              if (!event.currentTarget.checked) setManualStart(start)
              setFollowAudio(event.currentTarget.checked)
            }}
          />
          Follow audio
        </label>
        {props.ucsMode === "Single" ? (
          <span className="badge badge--info">DCM 10 lanes · UCS Single uses left pad</span>
        ) : null}
        <TimelineClock
          music={props.music}
          playback={props.playback}
          selectedTick={props.selectedTick}
        />
      </div>
      <section className="timeline__scroller" aria-label="Scrollable chart lanes">
        <div className="timeline__header" aria-hidden="true">
          <span>Tick</span>
          {laneLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="timeline__rows">
          <TimelinePlayhead
            playback={props.playback}
            start={start}
            pageTicks={pageTicks}
            followAudio={followAudio}
          />
          {ticks.map((rowTick) => (
            <div
              className={`timeline__row ${rowTick % props.chart.ticks_per_beat === 0 ? "is-beat" : ""}`}
              key={rowTick}
            >
              <span className="mono timeline__tick">{rowTick}</span>
              {laneIndices.map((panel) => {
                const state = cells.get(`${rowTick}:${panel}`) ?? "empty"
                const selected = props.selectedTick === rowTick && props.selectedLane === panel
                return (
                  <button
                    type="button"
                    aria-label={`${laneLabels[panel]}, tick ${rowTick}, ${state}`}
                    className={`timeline__cell ${panel < 5 ? "is-left" : "is-right"} note-${state}`}
                    data-selected={selected}
                    key={laneLabels[panel]}
                    ref={(element) => {
                      const key = `${rowTick}:${panel}`
                      if (element === null) cellRefs.current.delete(key)
                      else cellRefs.current.set(key, element)
                    }}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => props.onCell(rowTick, panel)}
                    onFocus={() => select(rowTick, panel)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") moveCursor(props.quantize, 0)
                      else if (event.key === "ArrowUp") moveCursor(-props.quantize, 0)
                      else if (event.key === "ArrowRight") moveCursor(0, 1)
                      else if (event.key === "ArrowLeft") moveCursor(0, -1)
                      else return
                      event.preventDefault()
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <details className="note-list">
          <summary>Structured note list ({props.chart.notes.length})</summary>
          <ol>
            {props.chart.notes.map((note) => (
              <li className="mono" key={`${note.tick}:${note.panel_mask}:${note.hold_ticks}`}>
                Tick {note.tick}, mask {note.panel_mask}, duration {note.hold_ticks}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </section>
  )
}

function usePlaybackWindowStart(
  playback: AudioPlaybackController,
  followAudio: boolean,
  manualStart: number,
  props: Pick<TimelineProps, "chart">,
): number {
  const getSnapshot = useCallback(() => {
    if (!followAudio) return manualStart
    const snapshot = playback.getSnapshot()
    if (!showsPlaybackClock(snapshot.status) || snapshot.chartTick === null) return manualStart
    return windowStart(snapshot.chartTick, props)
  }, [followAudio, manualStart, playback, props])
  return useSyncExternalStore(playback.subscribe, getSnapshot, getSnapshot)
}

function windowStart(sourceTick: number, props: Pick<TimelineProps, "chart">): number {
  return timelineWindowStart({
    sourceTick,
    spanTicks: props.chart.span_ticks,
  })
}
