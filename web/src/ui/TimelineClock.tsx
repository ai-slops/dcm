import type { NativeMusic } from "../../shared/index.ts"
import { timingContextAtTick } from "../domain/timeline.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

export function TimelineClock(props: {
  readonly music: NativeMusic
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly label?: string
}) {
  const snapshot = usePlaybackSnapshot(props.playback)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const tick = usesClock ? (snapshot.chartTick ?? 0) : props.selectedTick
  const context = timingContextAtTick(
    props.music,
    tick,
    usesClock ? snapshot.audioMicros : undefined,
  )
  return (
    <output className="timeline__context mono" aria-label={props.label ?? "Current timing context"}>
      <span>{context.songTime}</span>
      <span>{usesClock && snapshot.chartTick === null ? "Pre-roll" : `Beat ${context.beat}`}</span>
      <span>{context.bpm.toFixed(6).replace(/\.?0+$/, "")} BPM</span>
      <span>Offset {context.offset}</span>
    </output>
  )
}
