import {
  type AudioPlaybackController,
  showsPlaybackClock,
  usePlaybackSnapshot,
} from "./useAudioPlayback.ts"

export function TimelinePlayhead({
  playback,
  start,
  pageTicks,
  quantize,
}: {
  readonly playback: AudioPlaybackController
  readonly start: number
  readonly pageTicks: number
  readonly quantize: number
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const tick = snapshot.chartTick
  if (
    !showsPlaybackClock(snapshot.status) ||
    tick === null ||
    tick < start ||
    tick >= start + pageTicks
  ) {
    return null
  }
  return (
    <div
      aria-hidden="true"
      className="timeline__playhead"
      data-testid="timeline-playhead"
      style={{
        transform: `translateY(calc(${(tick - start) / quantize} * var(--timeline-row-size)))`,
      }}
    />
  )
}
