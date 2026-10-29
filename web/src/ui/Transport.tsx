import { AlertTriangle, Check, LoaderCircle, Pause, Play, Scissors, Square } from "lucide-react"
import { useMemo, useState } from "react"

import type { Beat, BeatChartDocument } from "../../shared/index.ts"
import { addBeats, compareBeats } from "../../shared/index.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { Badge, Button, IconButton } from "./primitives.tsx"
import { SegmentPlaybackDialog } from "./SegmentPlaybackDialog.tsx"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

type TransportProps = {
  readonly project: BeatChartDocument
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

function StatusIcon(props: {
  readonly status: ReturnType<AudioPlaybackController["getSnapshot"]>["status"]
}) {
  switch (props.status) {
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
  const [segmentOpen, setSegmentOpen] = useState(false)
  const playback = usePlaybackSnapshot(props.playback)
  const usesClock = showsPlaybackClock(playback.status) || playback.status === "ended"
  const visibleBeat = usesClock ? (playback.chartBeat ?? 0) : 0
  const maximumBeat = useMemo(() => documentExtent(props.project), [props.project])
  const scrubBeat = Math.min(Math.max(visibleBeat, 0), maximumBeat)
  const status = audioStatus(playback.status)
  const beatValue =
    playback.chartBeat === null && usesClock
      ? "PRE-ROLL"
      : visibleBeat.toFixed(3).replace(/\.?0+$/, "")
  const canPlay = ["ready", "playing", "paused", "ended"].includes(playback.status)

  return (
    <footer className="transport">
      <div className="transport__primary">
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
          onClick={() => props.playback.stop()}
        />
        <span className="mono transport__tick" data-testid="transport-beat">
          <span className="transport__tick-accessible">
            {beatValue === "PRE-ROLL" ? "Chart pre-roll" : `Chart beat ${beatValue}`}
          </span>
          <span aria-hidden="true">
            <span className="transport__tick-prefix">BEAT </span>
            {beatValue}
          </span>
        </span>
        <input
          aria-label="Chart beat position"
          aria-valuetext={`Beat ${scrubBeat.toFixed(3)} of ${maximumBeat.toFixed(3)}`}
          disabled={maximumBeat === 0}
          max={Math.max(maximumBeat, 1)}
          min="0"
          step="any"
          type="range"
          value={scrubBeat}
          onChange={(event) => props.playback.seekBeatPosition(Number(event.currentTarget.value))}
        />
        <Badge tone={status.tone}>
          <StatusIcon status={playback.status} /> {status.label}
        </Badge>
      </div>
      <div className="transport__secondary">
        <Button
          type="button"
          className="transport__segment"
          icon={<Scissors size={15} />}
          aria-pressed={playback.segment !== null}
          onClick={() => setSegmentOpen(true)}
        >
          Segment
        </Button>
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
            aria-label="Playback speed"
            value={playback.rate}
            onChange={(event) => props.playback.setRate(Number(event.currentTarget.value))}
          >
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
          </select>
        </label>
        <label className="transport__compact transport__volume">
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
      </div>
      {playback.error === null ? null : (
        <span className="transport__error" role="alert">
          {playback.error}
        </span>
      )}
      {segmentOpen ? (
        <SegmentPlaybackDialog playback={props.playback} onClose={() => setSegmentOpen(false)} />
      ) : null}
    </footer>
  )
}

function documentExtent(project: BeatChartDocument): number {
  if (project.timing.duration !== null)
    return project.timing.duration.numerator / project.timing.duration.denominator
  const zero = { numerator: 0, denominator: 1 } as const
  const end = project.notes.reduce<Beat>((latest, note) => {
    const tail = addBeats(note.at, note.hold)
    return compareBeats(tail, latest) > 0 ? tail : latest
  }, zero)
  return end.numerator / end.denominator
}
