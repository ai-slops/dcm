import { useCallback, useMemo, useState } from "react"

import {
  addBeats,
  type Beat,
  type BeatNote,
  type BeatTiming,
  beatFromTicks,
  compareBeats,
  type UcsMode,
} from "../../shared/index.ts"
import { beatTimelinePointsInAudioRange, laneTone } from "../domain/beat-timeline.ts"
import { audioMicrosToBeatPosition, beatToAudioMicros } from "../domain/beat-timing.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { laneLabels } from "./studio-types.ts"
import { TempoDialog } from "./TempoDialog.tsx"
import { TimelineControls } from "./TimelineControls.tsx"
import { TimelineEndLine } from "./TimelineEndLine.tsx"
import { TimelineNoteList } from "./TimelineNoteList.tsx"
import { TimelinePlayhead } from "./TimelinePlayhead.tsx"
import { type TimelineRegion, TimelineRows } from "./TimelineRows.tsx"
import {
  automaticTimelineEnd,
  initialTimelineSplit,
  timelineRegionAtBeat,
  timelineTimingWithEnd,
} from "./timeline-editor-model.ts"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"
import { usePlaybackSnapshot } from "./useAudioPlayback.ts"
import { useTimelineFollow } from "./useTimelineFollow.ts"
import { useTimelineGesture } from "./useTimelineGesture.ts"
import { useTimelineVirtualScroll } from "./useTimelineVirtualScroll.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const singleLaneIndices = [0, 1, 2, 3, 4] as const
export type TimelineProps = {
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
  readonly onToggleTap: (at: Beat, lane: PanelIndex) => void
  readonly onPlaceHold: (head: Beat, tail: Beat, lane: PanelIndex) => void
  readonly onTimingChange: (timing: BeatTiming) => void
  readonly automaticRegions?: readonly TimelineRegion[]
  readonly regionsReadOnly?: boolean
  readonly readOnly?: boolean
  readonly error?: string
}

export function Timeline(props: TimelineProps) {
  const lanes: readonly PanelIndex[] = props.mode === "Single" ? singleLaneIndices : laneIndices
  const [selectedSplit, setSelectedSplit] = useState(() => initialTimelineSplit(props.timing))
  const [lookaheadSeconds, setLookaheadSeconds] = useState(4)
  const [tempoBeat, setTempoBeat] = useState<Beat | null>(null)
  const [endError, setEndError] = useState("")
  const regions = props.automaticRegions ?? []
  const virtual = useTimelineVirtualScroll({
    timing: props.timing,
    lookaheadSeconds,
  })
  const snapshot = usePlaybackSnapshot(props.playback)
  const beatAtClientY = useCallback(
    (clientY: number) => {
      const position = audioMicrosToBeatPosition(
        props.timing,
        virtual.audioMicrosAtClientY(clientY),
      )
      return beatFromTicks(Math.max(0, Math.floor((position ?? 0) * selectedSplit)), selectedSplit)
    },
    [props.timing, selectedSplit, virtual.audioMicrosAtClientY],
  )

  const isReadOnly = useCallback(
    (at: Beat) =>
      props.readOnly === true ||
      (props.regionsReadOnly === true && timelineRegionAtBeat(regions, at) !== undefined),
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
    beatAtClientY,
  })

  useTimelineFollow({
    timing: props.timing,
    lookaheadSeconds,
    snapshot,
    pixelsPerMicrosecond: virtual.pixelsPerMicrosecond,
    followAudioMicros: virtual.followAudioMicros,
  })

  const headerLabels = useMemo(() => lanes.map((lane) => laneLabels[lane]), [lanes])
  const automaticEnd = useMemo(
    () => automaticTimelineEnd(props.timing, props.notes, regions),
    [props.notes, props.timing, regions],
  )
  const endBeat = props.timing.duration ?? automaticEnd
  const exactBeats = useMemo(
    () => [
      ...props.notes.flatMap((note) => [note.at, addBeats(note.at, note.hold)]),
      ...props.timing.tempo.map((marker) => marker.at),
      ...regions.flatMap((region) => [region.start, region.end]),
      endBeat,
    ],
    [endBeat, props.notes, props.timing.tempo, regions],
  )
  const points = useMemo(
    () =>
      beatTimelinePointsInAudioRange({
        timing: props.timing,
        selectedSplit,
        range: virtual.visibleAudioRange,
        exactBeats,
      }),
    [exactBeats, props.timing, selectedSplit, virtual.visibleAudioRange],
  )
  const activeRegion = points
    .map((point) => timelineRegionAtBeat(regions, point.beat))
    .find(Boolean)

  function changeEnd(next: Beat | null): boolean {
    const result = timelineTimingWithEnd(props.timing, next, props.notes, regions)
    if (result.kind === "error") {
      setEndError(result.message)
      return false
    }
    try {
      props.onTimingChange(result.timing)
    } catch (caught) {
      if (caught instanceof Error) {
        setEndError(caught.message)
        return false
      }
      throw caught
    }
    setEndError("")
    return true
  }

  const endPositionForBeat = useCallback(
    (beat: Beat) => virtual.audioMicrosToY(beatToAudioMicros(props.timing, beat)),
    [props.timing, virtual.audioMicrosToY],
  )

  return (
    <section
      className={`timeline timeline--${props.mode.toLowerCase()}`}
      id="chart-editor"
      aria-label={`${lanes.length}-lane ${props.mode} beat chart editor`}
      data-lookahead-seconds={lookaheadSeconds}
    >
      <TimelineControls
        timing={props.timing}
        mode={props.mode}
        playback={props.playback}
        selectedSplit={selectedSplit}
        pixelsPerSecond={virtual.pixelsPerMicrosecond * 1_000_000}
        lookaheadSeconds={lookaheadSeconds}
        disabled={props.readOnly === true}
        {...(props.error ? { error: props.error } : {})}
        onSelectedSplitChange={setSelectedSplit}
        onLookaheadChange={setLookaheadSeconds}
        onTimingChange={props.onTimingChange}
      />
      {props.mode === "Double" ? (
        <p className="timeline__scroll-cue" role="note">
          Scroll sideways inside the timeline to reach all 10 lanes.
        </p>
      ) : null}
      <section
        className="timeline__scroller"
        aria-label="Scrollable beat chart lanes"
        tabIndex={-1}
        ref={virtual.scrollerRef}
        onScroll={virtual.onScroll}
        {...gesture}
      >
        <div className="timeline__header" aria-hidden="true">
          {headerLabels.map((label, index) => (
            <span data-tone={laneTone(lanes[index] ?? 0)} key={label}>
              {label}
            </span>
          ))}
          <span>Beat / Tempo</span>
        </div>
        {activeRegion === undefined ? null : (
          <div className="timeline__active-region">
            <span>{activeRegion.name} · automatic</span>
          </div>
        )}
        <TimelinePlayhead />
        <div className="timeline__rows" style={{ blockSize: virtual.runwaySize }}>
          <div className="timeline__virtual-window">
            <div className="timeline__lane-surfaces" aria-hidden="true">
              {lanes.map((lane) => (
                <div className="timeline__lane-surface" data-lane={lane} key={lane} />
              ))}
            </div>
            <TimelineRows
              points={points}
              notes={props.notes}
              timing={props.timing}
              lanes={lanes}
              selectedSplit={selectedSplit}
              regions={regions}
              regionsReadOnly={props.regionsReadOnly === true}
              readOnly={props.readOnly === true}
              visibleAudioRange={virtual.visibleAudioRange}
              runwaySize={virtual.runwaySize}
              audioMicrosToY={virtual.audioMicrosToY}
              onOpenTempo={setTempoBeat}
            />
            {endPositionForBeat(endBeat) <
              virtual.audioMicrosToY(virtual.visibleAudioRange.startMicros) ||
            endPositionForBeat(endBeat) >
              virtual.audioMicrosToY(virtual.visibleAudioRange.endMicros) ? null : (
              <TimelineEndLine
                at={endBeat}
                automatic={props.timing.duration === null}
                disabled={props.readOnly === true}
                selectedSplit={selectedSplit}
                error={endError}
                positionY={endPositionForBeat(endBeat)}
                beatAtClientY={beatAtClientY}
                positionYForBeat={endPositionForBeat}
                onChange={changeEnd}
              />
            )}
          </div>
        </div>
      </section>
      <TimelineNoteList notes={props.notes} />
      {tempoBeat === null ? null : (
        <TempoDialog
          at={tempoBeat}
          timing={props.timing}
          focusFallbackRef={virtual.scrollerRef}
          onClose={() => setTempoBeat(null)}
          onTimingChange={props.onTimingChange}
        />
      )}
    </section>
  )
}
