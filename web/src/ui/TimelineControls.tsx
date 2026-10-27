import type { NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { TimelineClock } from "./TimelineClock.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

const quantizeOptions = [1, 2, 4, 8] as const

type TimelineControlsProps = {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly ucsMode: UcsMode
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly selectedLane: PanelIndex
  readonly quantize: number
  readonly followAudio: boolean
  readonly onQuantize: (ticks: number) => void
  readonly setFollowAudio: (value: boolean) => void
  readonly select: (tick: number, lane: PanelIndex) => void
}

export function TimelineControls(props: TimelineControlsProps) {
  return (
    <div className="timeline__controls">
      <label>
        Quantize
        <select
          value={props.quantize}
          onChange={(event) => {
            const value = quantizeOptions[event.currentTarget.selectedIndex]
            if (value !== undefined) props.onQuantize(value)
          }}
        >
          {quantizeOptions
            .filter((step) => step <= props.chart.ticks_per_beat * 2)
            .map((step) => (
              <option key={step} value={step}>
                {step} tick{step === 1 ? "" : "s"}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() =>
          props.select(
            Math.max(0, props.selectedTick - props.chart.ticks_per_beat),
            props.selectedLane,
          )
        }
      >
        Previous beat
      </button>
      <label>
        Go to tick
        <input
          className="mono"
          min="0"
          max={props.chart.span_ticks - 1}
          type="number"
          value={props.selectedTick}
          onChange={(event) => {
            if (Number.isFinite(event.currentTarget.valueAsNumber))
              props.select(event.currentTarget.valueAsNumber, props.selectedLane)
          }}
        />
      </label>
      <button
        type="button"
        onClick={() =>
          props.select(
            Math.min(props.chart.span_ticks - 1, props.selectedTick + props.chart.ticks_per_beat),
            props.selectedLane,
          )
        }
      >
        Next beat
      </button>
      <label className="timeline__follow">
        <input
          type="checkbox"
          checked={props.followAudio}
          onChange={(event) => props.setFollowAudio(event.currentTarget.checked)}
        />
        Follow audio
      </label>
      <span className="badge badge--info">
        {props.ucsMode} ·{" "}
        {props.ucsMode === "Single" ? "5 lanes · left pad" : "10 lanes · two pads"}
      </span>
      <TimelineClock
        music={props.music}
        playback={props.playback}
        selectedTick={props.selectedTick}
      />
    </div>
  )
}
