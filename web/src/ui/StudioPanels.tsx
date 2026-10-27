import { useMemo } from "react"

import type { NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import {
  activePanelMaskAtAudioIntervals,
  activePanelMaskAtSelectedTick,
  buildNoteAudioIntervals,
} from "../domain/playback.ts"
import { laneTone } from "../domain/timeline.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { Panel } from "./primitives.tsx"
import { ScrollingChartPreview } from "./ScrollingChartPreview.tsx"
import { laneLabels } from "./studio-types.ts"
import { TimelineClock } from "./TimelineClock.tsx"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

export function Preview({
  chart,
  music,
  selectedTick,
  playback,
  ucsMode = "Double",
}: {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly selectedTick: number
  readonly playback: AudioPlaybackController
  readonly ucsMode?: UcsMode
}) {
  return (
    <Panel title="Chart preview" className="preview">
      {ucsMode === "Single" ? (
        <p className="status-copy">UCS Single preference · left-pad mapping</p>
      ) : null}
      <ScrollingChartPreview
        chart={chart}
        music={music}
        mode={ucsMode}
        playback={playback}
        selectedTick={selectedTick}
      />
      <PlayfieldPads
        chart={chart}
        music={music}
        playback={playback}
        selectedTick={selectedTick}
        mode={ucsMode}
      />
      <TimelineClock
        music={music}
        playback={playback}
        selectedTick={selectedTick}
        label="Preview timing context"
      />
    </Panel>
  )
}

export function PlayfieldPads({
  chart,
  music,
  selectedTick,
  playback,
  mode = "Double",
}: {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly selectedTick: number
  readonly playback: AudioPlaybackController
  readonly mode?: UcsMode
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const audioIntervals = useMemo(() => buildNoteAudioIntervals(chart, music), [chart, music])
  const mask = useMemo(
    () =>
      snapshot.status === "ended"
        ? 0
        : usesClock
          ? activePanelMaskAtAudioIntervals(audioIntervals, snapshot.audioMicros)
          : activePanelMaskAtSelectedTick(chart, selectedTick),
    [audioIntervals, chart, selectedTick, snapshot.audioMicros, snapshot.status, usesClock],
  )
  const groups =
    mode === "Single"
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
        {snapshot.chartTick === null && usesClock
          ? "PRE-ROLL"
          : `TICK ${(usesClock ? (snapshot.chartTick ?? 0) : selectedTick).toFixed(usesClock ? 2 : 0)}`}
      </p>
      <p className="preview__summary" aria-live="polite">
        {activeLabels.length === 0 ? "No active contacts" : `Active: ${activeLabels.join(", ")}`}
      </p>
    </section>
  )
}
