export type PlaybackStatus =
  | "no-audio"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error"

export type PlaybackSnapshot = {
  readonly status: PlaybackStatus
  readonly audioMicros: number
  readonly chartTick: number | null
  readonly error: string | null
  readonly loop: boolean
  readonly rate: number
  readonly volume: number
}

export const initialPlaybackSnapshot: PlaybackSnapshot = {
  status: "no-audio",
  audioMicros: 0,
  chartTick: null,
  error: null,
  loop: false,
  rate: 1,
  volume: 1,
}

export function showsPlaybackClock(status: PlaybackStatus): boolean {
  return status === "playing" || status === "paused"
}

export function boundedAudioSeconds(
  audio: Pick<HTMLMediaElement, "duration">,
  audioMicros: number,
): number {
  const requestedSeconds = Math.max(0, audioMicros / 1_000_000)
  return Number.isFinite(audio.duration)
    ? Math.min(requestedSeconds, audio.duration)
    : requestedSeconds
}
