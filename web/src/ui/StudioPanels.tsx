import { useMemo, useRef } from "react"

import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { activePanelMaskAtAudioMicros, activePanelMaskAtSelectedTick } from "../domain/playback.ts"
import { Panel } from "./primitives.tsx"
import { laneLabels } from "./studio-types.ts"
import { TimelinePlayhead } from "./TimelinePlayhead.tsx"
import {
  type AudioPlaybackController,
  showsPlaybackClock,
  usePlaybackSnapshot,
} from "./useAudioPlayback.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const quantizeOptions = [1, 2, 4, 8] as const

type TimelineProps = {
  readonly chart: NativeChart
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly selectedLane: PanelIndex
  readonly quantize: number
  readonly onQuantize: (ticks: number) => void
  readonly onCell: (tick: number, lane: PanelIndex) => void
  readonly onSelect: (tick: number, lane: PanelIndex) => void
}

function noteState(chart: NativeChart, tick: number, panel: PanelIndex): string {
  const bit = 1 << panel
  const note = chart.notes.find(
    (item) =>
      (item.panel_mask & bit) !== 0 && item.tick <= tick && item.tick + item.hold_ticks >= tick,
  )
  if (note === undefined) return "empty"
  if (note.tick === tick) return note.hold_ticks === 0 ? "tap" : "hold-head"
  return note.tick + note.hold_ticks === tick ? "hold-tail" : "hold-body"
}

export function Timeline(props: TimelineProps) {
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())
  const pageTicks = props.quantize * 48
  const start = Math.floor(props.selectedTick / pageTicks) * pageTicks
  const ticks = Array.from({ length: 48 }, (_, index) => start + index * props.quantize).filter(
    (value) => value < props.chart.span_ticks,
  )
  function moveCursor(tickDelta: number, laneDelta: number) {
    const nextTick = Math.min(
      Math.max(props.selectedTick + tickDelta, 0),
      props.chart.span_ticks - 1,
    )
    const nextLane = laneIndices[Math.min(Math.max(props.selectedLane + laneDelta, 0), 9)]
    if (nextLane === undefined) return
    props.onSelect(nextTick, nextLane)
    cellRefs.current.get(`${nextTick}:${nextLane}`)?.focus()
  }
  return (
    <section className="timeline" id="chart-editor" aria-label="Ten-lane chart editor">
      <div className="timeline__controls">
        <label>
          Quantize{" "}
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
          onClick={() => props.onSelect(Math.max(0, start - pageTicks), props.selectedLane)}
        >
          Previous
        </button>
        <label>
          Go to tick{" "}
          <input
            className="mono"
            min="0"
            max={props.chart.span_ticks - 1}
            type="number"
            value={props.selectedTick}
            onChange={(event) => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                props.onSelect(event.currentTarget.valueAsNumber, props.selectedLane)
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            props.onSelect(
              Math.min(props.chart.span_ticks - 1, start + pageTicks),
              props.selectedLane,
            )
          }
        >
          Next
        </button>
      </div>
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
          quantize={props.quantize}
        />
        {ticks.map((rowTick) => (
          <div
            className={`timeline__row ${rowTick % props.chart.ticks_per_beat === 0 ? "is-beat" : ""}`}
            key={rowTick}
          >
            <span className="mono timeline__tick">{rowTick}</span>
            {laneIndices.map((panel) => {
              const state = noteState(props.chart, rowTick, panel)
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
                  onFocus={() => props.onSelect(rowTick, panel)}
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
  )
}

export function Preview({
  chart,
  music,
  selectedTick,
  playback,
}: {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly selectedTick: number
  readonly playback: AudioPlaybackController
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const mask = useMemo(
    () =>
      snapshot.status === "ended"
        ? 0
        : usesClock
          ? activePanelMaskAtAudioMicros(chart, music, snapshot.audioMicros)
          : activePanelMaskAtSelectedTick(chart, selectedTick),
    [chart, music, selectedTick, snapshot.audioMicros, snapshot.status, usesClock],
  )
  const groups = [
    [1, 3, 2, 0, 4],
    [6, 8, 7, 5, 9],
  ] as const
  const activeLabels = laneLabels.filter((_, index) => (mask & (1 << index)) !== 0)
  return (
    <Panel title="Playfield preview" className="preview">
      <div className="playfields">
        {groups.map((group, side) => (
          <section
            className="playfield"
            aria-label={`${side === 0 ? "Left" : "Right"} pad`}
            key={side === 0 ? "left" : "right"}
          >
            {group.map((index) => (
              <div
                className={`pad pad--${index < 5 ? "left" : "right"}`}
                data-active={(mask & (1 << index)) !== 0}
                data-position={index % 5}
                key={laneLabels[index]}
              >
                <span>{laneLabels[index].slice(2)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="mono preview__time" data-testid="preview-time">
        {snapshot.chartTick === null && usesClock
          ? "PRE-ROLL"
          : `TICK ${(usesClock ? (snapshot.chartTick ?? 0) : selectedTick).toFixed(usesClock ? 2 : 0)}`}
      </p>
      <p className="preview__summary" aria-live="polite">
        {activeLabels.length === 0 ? "No active contacts" : `Active: ${activeLabels.join(", ")}`}
      </p>
    </Panel>
  )
}
