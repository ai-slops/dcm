import { TIMELINE_RUNWAY_CENTER_ROW } from "../domain/timeline.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

export function TimelinePlayhead({
  playback,
  originTick,
  rowSize,
}: {
  readonly playback: AudioPlaybackController
  readonly originTick: number
  readonly rowSize: number
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const tick = snapshot.chartTick
  if (!showsPlaybackClock(snapshot.status) || tick === null) return null
  return (
    <div
      aria-hidden="true"
      className="timeline__playhead"
      data-testid="timeline-playhead"
      style={{
        transform: `translateY(${(TIMELINE_RUNWAY_CENTER_ROW + tick - originTick) * rowSize}px)`,
      }}
    />
  )
}
