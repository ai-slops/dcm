import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { AutomaticRegionView, NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import {
  buildVisibleCellIndex,
  laneTone,
  timelineRangeIntersectsRegions,
} from "../domain/timeline.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { laneLabels } from "./studio-types.ts"
import { TimelineControls } from "./TimelineControls.tsx"
import { TimelinePlayhead } from "./TimelinePlayhead.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"
import { usePlaybackSnapshot } from "./useAudioPlayback.ts"
import { useTimelineGesture } from "./useTimelineGesture.ts"
import { useTimelineVirtualScroll } from "./useTimelineVirtualScroll.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const singleLaneIndices = [0, 1, 2, 3, 4] as const

export type TimelineProps = {
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
  readonly onHold?: (startTick: number, endTick: number, lane: PanelIndex) => void
  readonly automaticRegions?: readonly AutomaticRegionView[] | undefined
  readonly regionsReadOnly?: boolean
}

export function Timeline(props: TimelineProps) {
  const playableLanes = props.ucsMode === "Single" ? singleLaneIndices : laneIndices
  const [followAudio, setFollowAudio] = useState(true)
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())
  const previousSelectedTick = useRef(props.selectedTick)
  const virtual = useTimelineVirtualScroll({
    spanTicks: props.chart.span_ticks,
    anchorTick: props.selectedTick,
  })
  const snapshot = usePlaybackSnapshot(props.playback)
  const cells = useMemo(
    () =>
      buildVisibleCellIndex(
        props.chart,
        virtual.virtualWindow.startTick,
        virtual.virtualWindow.rows.length,
      ),
    [props.chart, virtual.virtualWindow.rows.length, virtual.virtualWindow.startTick],
  )
  const regionAtTick = useCallback(
    (tick: number) =>
      props.automaticRegions?.find((region) => tick >= region.start_tick && tick < region.end_tick),
    [props.automaticRegions],
  )
  const isReadOnly = useCallback(
    (tick: number) => props.regionsReadOnly === true && regionAtTick(tick) !== undefined,
    [props.regionsReadOnly, regionAtTick],
  )
  const activeRegion = regionAtTick(virtual.virtualWindow.visibleTick)
  const gesture = useTimelineGesture({
    onCell: props.onCell,
    onHold: props.onHold,
    isReadOnly,
    isRangeReadOnly: (startTick, endTick) =>
      props.regionsReadOnly === true &&
      timelineRangeIntersectsRegions(startTick, endTick, props.automaticRegions ?? []),
  })

  useEffect(() => {
    if (previousSelectedTick.current === props.selectedTick) return
    previousSelectedTick.current = props.selectedTick
    virtual.revealTick(props.selectedTick)
  }, [props.selectedTick, virtual.revealTick])
  useEffect(() => {
    if (followAudio && showsPlaybackClock(snapshot.status) && snapshot.chartTick !== null)
      virtual.followTick(snapshot.chartTick)
  }, [followAudio, snapshot.chartTick, snapshot.status, virtual.followTick])

  function select(nextTick: number, nextLane: PanelIndex): void {
    setFollowAudio(false)
    virtual.revealTick(nextTick)
    props.onSelect(nextTick, nextLane)
  }

  function moveCursor(tickDelta: number, laneDelta: number): void {
    const nextTick = Math.min(
      Math.max(props.selectedTick + tickDelta, 0),
      props.chart.span_ticks - 1,
    )
    const nextLane =
      playableLanes[Math.min(Math.max(props.selectedLane + laneDelta, 0), playableLanes.length - 1)]
    if (nextLane === undefined) return
    select(nextTick, nextLane)
    requestAnimationFrame(() => cellRefs.current.get(`${nextTick}:${nextLane}`)?.focus())
  }

  return (
    <section
      className={`timeline timeline--${props.ucsMode.toLowerCase()}`}
      id="chart-editor"
      aria-label={`${playableLanes.length}-lane ${props.ucsMode} chart editor`}
    >
      <TimelineControls
        chart={props.chart}
        music={props.music}
        ucsMode={props.ucsMode}
        playback={props.playback}
        selectedTick={props.selectedTick}
        selectedLane={props.selectedLane}
        quantize={props.quantize}
        onQuantize={props.onQuantize}
        followAudio={followAudio}
        setFollowAudio={setFollowAudio}
        select={select}
      />
      <section
        className="timeline__scroller"
        aria-label="Scrollable chart lanes"
        ref={virtual.scrollerRef}
        onScroll={virtual.onScroll}
        onWheel={() => setFollowAudio(false)}
        {...gesture}
      >
        <div className="timeline__header" aria-hidden="true">
          <span>Tick</span>
          {playableLanes.map((lane) => (
            <span data-tone={laneTone(lane)} key={laneLabels[lane]}>
              {laneLabels[lane]}
            </span>
          ))}
        </div>
        {activeRegion === undefined ? null : (
          <div className="timeline__active-region" aria-hidden="true">
            <span>{activeRegion.name} · automatic</span>
          </div>
        )}
        <div className="timeline__rows" style={{ blockSize: virtual.runwaySize }}>
          <TimelinePlayhead
            playback={props.playback}
            originTick={virtual.originTick}
            rowSize={virtual.rowSize}
          />
          <div
            className="timeline__virtual-window"
            style={{ transform: `translateY(${virtual.virtualWindow.offset}px)` }}
          >
            {virtual.virtualWindow.rows.map((rowTick, index) => {
              const region = regionAtTick(rowTick)
              const showRegionName =
                region !== undefined && (index === 0 || regionAtTick(rowTick - 1)?.id !== region.id)
              return (
                <div
                  className={`timeline__row ${rowTick % props.chart.ticks_per_beat === 0 ? "is-beat" : ""}`}
                  data-region={region === undefined ? undefined : "automatic"}
                  key={rowTick}
                  style={{ transform: `translateY(${index * virtual.rowSize}px)` }}
                >
                  <span className="mono timeline__tick">{rowTick}</span>
                  {showRegionName ? (
                    <span className="timeline__region-label">{region.name} · automatic</span>
                  ) : null}
                  {playableLanes.map((panel) => {
                    const state = cells.get(`${rowTick}:${panel}`) ?? "empty"
                    const selected = props.selectedTick === rowTick && props.selectedLane === panel
                    return (
                      <button
                        type="button"
                        aria-label={`${laneLabels[panel]}, tick ${rowTick}, ${state}${region === undefined ? "" : `, automatic region ${region.name}`}`}
                        aria-disabled={isReadOnly(rowTick) || undefined}
                        className={`timeline__cell note-${state}`}
                        data-lane={panel}
                        data-read-only={isReadOnly(rowTick) || undefined}
                        data-selected={selected}
                        data-tick={rowTick}
                        data-tone={laneTone(panel)}
                        key={laneLabels[panel]}
                        ref={(element) => setCellRef(cellRefs.current, rowTick, panel, element)}
                        tabIndex={selected ? 0 : -1}
                        onFocus={() => select(rowTick, panel)}
                        onKeyDown={(event) =>
                          handleCellKey(
                            event.key,
                            event.preventDefault.bind(event),
                            () => props.onCell(rowTick, panel),
                            (tickDelta, laneDelta) => moveCursor(tickDelta, laneDelta),
                            props.quantize,
                            isReadOnly(rowTick),
                          )
                        }
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
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

function setCellRef(
  refs: Map<string, HTMLButtonElement>,
  tick: number,
  panel: PanelIndex,
  element: HTMLButtonElement | null,
): void {
  const key = `${tick}:${panel}`
  if (element === null) refs.delete(key)
  else refs.set(key, element)
}

function handleCellKey(
  key: string,
  preventDefault: () => void,
  activate: () => void,
  move: (tickDelta: number, laneDelta: number) => void,
  quantize: number,
  readOnly: boolean,
): void {
  if ((key === "Enter" || key === " ") && !readOnly) activate()
  else if (key === "ArrowDown") move(quantize, 0)
  else if (key === "ArrowUp") move(-quantize, 0)
  else if (key === "ArrowRight") move(0, 1)
  else if (key === "ArrowLeft") move(0, -1)
  else return
  preventDefault()
}
