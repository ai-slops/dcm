import { useEffect } from "react"

import type { BeatTiming } from "../../shared/index.ts"
import type { PlaybackSnapshot } from "./audio-playback-state.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"

type TimelineFollowInput = {
  readonly timing: BeatTiming
  readonly lookaheadSeconds: number
  readonly snapshot: PlaybackSnapshot
  readonly pixelsPerMicrosecond: number
  readonly followAudioMicros: (audioMicros: number) => void
}

export function useTimelineFollow(input: TimelineFollowInput): void {
  const { timing, lookaheadSeconds, snapshot, pixelsPerMicrosecond, followAudioMicros } = input
  useEffect(() => {
    if (
      !showsPlaybackClock(snapshot.status) ||
      lookaheadSeconds <= 0 ||
      timing.tempo.length === 0 ||
      pixelsPerMicrosecond <= 0
    )
      return
    followAudioMicros(snapshot.audioMicros)
  }, [
    followAudioMicros,
    lookaheadSeconds,
    pixelsPerMicrosecond,
    snapshot.audioMicros,
    snapshot.status,
    timing,
  ])
}
