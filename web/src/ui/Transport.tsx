import { AlertTriangle, Check, LoaderCircle, Pause, Play, Square } from "lucide-react"

import type { StudioProjectV1 } from "../../shared/index.ts"
import { Badge, IconButton } from "./primitives.tsx"
import {
  type AudioPlaybackController,
  showsPlaybackClock,
  usePlaybackSnapshot,
} from "./useAudioPlayback.ts"

type TransportProps = {
  readonly project: StudioProjectV1
  readonly selectedTick: number
  readonly onSeekSelection: (tick: number) => void
  readonly playback: AudioPlaybackController
}

function audioStatus(status: ReturnType<AudioPlaybackController["getSnapshot"]>["status"]): {
  readonly label: string
  readonly tone: string
} {
  switch (status) {
    case "no-audio":
      return { label: "No audio", tone: "warning" }
    case "loading":
      return { label: "Audio loading", tone: "info" }
    case "ready":
      return { label: "Audio ready", tone: "success" }
    case "playing":
      return { label: "Playing", tone: "info" }
    case "paused":
      return { label: "Paused", tone: "warning" }
    case "ended":
      return { label: "Ended", tone: "neutral" }
    case "error":
      return { label: "Audio error", tone: "error" }
  }
}

function StatusIcon({
  status,
}: {
  readonly status: ReturnType<AudioPlaybackController["getSnapshot"]>["status"]
}) {
  switch (status) {
    case "loading":
      return <LoaderCircle size={12} />
    case "ready":
    case "playing":
      return <Check size={12} />
    case "no-audio":
    case "paused":
    case "error":
      return <AlertTriangle size={12} />
    case "ended":
      return <Square size={10} />
  }
}

export function Transport(props: TransportProps) {
  const playback = usePlaybackSnapshot(props.playback)
  const usesClock = showsPlaybackClock(playback.status) || playback.status === "ended"
  const visibleTick = usesClock ? (playback.chartTick ?? 0) : props.selectedTick
  const scrubTick = Math.min(Math.max(visibleTick, 0), props.project.chart.span_ticks)
  const status = audioStatus(playback.status)
  const canPlay =
    playback.status === "ready" ||
    playback.status === "playing" ||
    playback.status === "paused" ||
    playback.status === "ended"

  return (
    <footer className="transport">
      <IconButton
        label={playback.status === "playing" ? "Pause" : "Play"}
        icon={playback.status === "playing" ? <Pause size={16} /> : <Play size={16} />}
        disabled={!canPlay}
        onClick={() => void props.playback.toggle()}
      />
      <IconButton
        label="Stop"
        icon={<Square size={14} />}
        disabled={!canPlay}
        onClick={() => {
          props.playback.stop()
          props.onSeekSelection(0)
        }}
      />
      <span className="mono" data-testid="transport-tick">
        {playback.chartTick === null && usesClock
          ? "PRE-ROLL"
          : `TICK ${usesClock ? visibleTick.toFixed(2).padStart(9, "0") : String(Math.floor(visibleTick)).padStart(6, "0")}`}
      </span>
      <input
        aria-label="Chart position"
        aria-valuetext={`Tick ${scrubTick.toFixed(2)} of ${props.project.chart.span_ticks}`}
        max={props.project.chart.span_ticks}
        min="0"
        step="any"
        type="range"
        value={scrubTick}
        onChange={(event) => {
          const nextTick = Number(event.currentTarget.value)
          props.playback.seek(nextTick)
          props.onSeekSelection(Math.min(nextTick, props.project.chart.span_ticks - 1))
        }}
      />
      <label className="transport__compact">
        Loop{" "}
        <input
          type="checkbox"
          checked={playback.loop}
          onChange={(event) => props.playback.setLoop(event.currentTarget.checked)}
        />
      </label>
      <label className="transport__compact">
        Speed{" "}
        <select
          value={playback.rate}
          onChange={(event) => props.playback.setRate(Number(event.currentTarget.value))}
        >
          <option value="0.75">0.75x</option>
          <option value="1">1x</option>
          <option value="1.25">1.25x</option>
        </select>
      </label>
      <label className="transport__compact">
        Volume{" "}
        <input
          aria-label="Volume"
          max="1"
          min="0"
          step="0.05"
          type="range"
          value={playback.volume}
          onChange={(event) => props.playback.setVolume(Number(event.currentTarget.value))}
        />
      </label>
      <Badge tone={status.tone}>
        <StatusIcon status={playback.status} /> {status.label}
      </Badge>
      {playback.error === null ? null : (
        <span className="transport__error" role="alert">
          {playback.error}
        </span>
      )}
    </footer>
  )
}
