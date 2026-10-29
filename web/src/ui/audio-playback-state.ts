export type PlaybackStatus =
  | "no-audio"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error"

export type PlaybackSegment = {
  readonly startSeconds: number
  readonly endSeconds: number
  readonly loop: boolean
}

export type PlaybackSnapshot = {
  readonly status: PlaybackStatus
  readonly audioMicros: number
  readonly chartBeat: number | null
  readonly durationSeconds: number | null
  readonly error: string | null
  readonly loop: boolean
  readonly rate: number
  readonly segment: PlaybackSegment | null
  readonly volume: number
}

export const initialPlaybackSnapshot: PlaybackSnapshot = {
  status: "no-audio",
  audioMicros: 0,
  chartBeat: null,
  durationSeconds: null,
  error: null,
  loop: false,
  rate: 1,
  segment: null,
  volume: 1,
}

export function showsPlaybackClock(status: PlaybackStatus): boolean {
  return status === "playing" || status === "paused"
}

export function canControlPlayback(status: PlaybackStatus): boolean {
  return status !== "no-audio" && status !== "loading" && status !== "error"
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

export function validatedPlaybackSegment(
  startSeconds: number,
  endSeconds: number,
  loop: boolean,
  durationSeconds: number,
): PlaybackSegment {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError("Audio duration is not available yet.")
  }
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new RangeError("Segment start and end must be finite audio seconds.")
  }
  if (startSeconds < 0 || startSeconds >= endSeconds || endSeconds > durationSeconds) {
    throw new RangeError(
      `Segment must satisfy 0 <= start < end <= ${durationSeconds.toFixed(3)} audio seconds.`,
    )
  }
  return { startSeconds, endSeconds, loop }
}
