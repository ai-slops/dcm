import type { Beat, BeatTiming } from "../../shared/beat.ts"
import { formatBeat } from "../domain/beat-timeline.ts"
import {
  audioMicrosToBeatPosition,
  beatToAudioMicros,
  bpmAtBeat,
  bpmAtBeatPosition,
} from "../domain/beat-timing.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

export function TimelineClock(props: {
  readonly timing: BeatTiming
  readonly playback: AudioPlaybackController
  readonly cursorBeat: Beat
  readonly label?: string
}) {
  const snapshot = usePlaybackSnapshot(props.playback)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const playbackBeat = usesClock
    ? audioMicrosToBeatPosition(props.timing, snapshot.audioMicros)
    : null
  const bpm =
    playbackBeat === null
      ? bpmAtBeat(props.timing, props.cursorBeat)
      : bpmAtBeatPosition(props.timing, playbackBeat)
  const audioMicros = usesClock
    ? snapshot.audioMicros
    : beatToAudioMicros(props.timing, props.cursorBeat)
  return (
    <output className="timeline__context mono" aria-label={props.label ?? "Current timing context"}>
      <span>{formatSongTime(audioMicros)}</span>
      <span>
        {usesClock && playbackBeat === null
          ? "Pre-roll"
          : `Beat ${playbackBeat === null ? formatBeat(props.cursorBeat) : formatBeatPosition(playbackBeat)}`}
      </span>
      <span>{formatBpm(bpm)} BPM</span>
      <span>Offset {formatOffset(props.timing.offset_micros)}</span>
    </output>
  )
}

function formatBeatPosition(position: number): string {
  return position.toFixed(3).replace(/\.?0+$/, "")
}

function formatBpm(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "")
}

function formatSongTime(audioMicros: number): string {
  const absoluteMillis = Math.round(Math.abs(audioMicros) / 1_000)
  const minutes = Math.floor(absoluteMillis / 60_000)
  const seconds = Math.floor((absoluteMillis % 60_000) / 1_000)
  const millis = absoluteMillis % 1_000
  const sign = audioMicros < 0 ? "−" : ""
  return `${sign}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

function formatOffset(offsetMicros: number): string {
  const prefix = offsetMicros >= 0 ? "+" : "−"
  const milliseconds = (Math.abs(offsetMicros) / 1_000).toFixed(3).replace(/\.?0+$/, "")
  return `${prefix}${milliseconds} ms`
}
