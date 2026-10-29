import { useMemo } from "react"

import type { BeatNote, BeatTiming, UcsMode } from "../../shared/index.ts"
import { laneTone } from "../domain/beat-timeline.ts"
import { activePanelMaskAtAudioIntervals, buildNoteAudioIntervals } from "../domain/playback.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { Panel } from "./primitives.tsx"
import { ScrollingChartPreview } from "./ScrollingChartPreview.tsx"
import { laneLabels } from "./studio-types.ts"
import { TimelineClock } from "./TimelineClock.tsx"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

const zero = { numerator: 0, denominator: 1 } as const

export function Preview(props: {
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
}) {
  return (
    <Panel title="Chart preview" className="preview">
      {props.mode === "Single" ? (
        <p className="status-copy">UCS Single preference · left-pad mapping</p>
      ) : null}
      <ScrollingChartPreview
        notes={props.notes}
        timing={props.timing}
        mode={props.mode}
        playback={props.playback}
      />
      <PlayfieldPads {...props} />
      <TimelineClock
        timing={props.timing}
        playback={props.playback}
        cursorBeat={zero}
        label="Preview timing context"
      />
    </Panel>
  )
}

export function PlayfieldPads(props: {
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly playback: AudioPlaybackController
  readonly mode?: UcsMode
}) {
  const snapshot = usePlaybackSnapshot(props.playback)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const intervals = useMemo(
    () => buildNoteAudioIntervals(props.notes, props.timing),
    [props.notes, props.timing],
  )
  const mask =
    snapshot.status === "ended" || !usesClock
      ? 0
      : activePanelMaskAtAudioIntervals(intervals, snapshot.audioMicros)
  const groups =
    props.mode === "Single"
      ? ([[1, 3, 2, 0, 4]] as const)
      : ([
          [1, 3, 2, 0, 4],
          [6, 8, 7, 5, 9],
        ] as const)
  const activeLabels = laneLabels.filter((_, index) => (mask & (1 << index)) !== 0)
  return (
    <section className="playfield-preview" aria-label="Physical pad contacts">
      <div className="playfields">
        {groups.map((group, side) => (
          <section
            className="playfield-group"
            aria-label={`${side === 0 ? "Left" : "Right"} pad`}
            key={side === 0 ? "left" : "right"}
          >
            <h3 className="playfield__side">{side === 0 ? "Left pad · L" : "Right pad · R"}</h3>
            <div className="playfield">
              {group.map((index) => (
                <div
                  className="pad"
                  data-active={(mask & (1 << index)) !== 0}
                  data-position={index % 5}
                  data-tone={laneTone(index)}
                  key={laneLabels[index]}
                >
                  <span>{laneLabels[index].slice(2)}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mono preview__time" data-testid="preview-time">
        {snapshot.chartBeat === null && usesClock
          ? "PRE-ROLL"
          : `BEAT ${(snapshot.chartBeat ?? 0).toFixed(3).replace(/\.?0+$/, "")}`}
      </p>
      <p className="preview__summary" aria-live="polite">
        {activeLabels.length === 0 ? "No active contacts" : `Active: ${activeLabels.join(", ")}`}
      </p>
    </section>
  )
}
