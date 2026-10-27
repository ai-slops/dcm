import { useMemo, useState } from "react"

import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { buildChartPreviewIndex, projectVisibleContacts } from "../domain/chart-preview.ts"
import { tickToAudioMicros } from "../domain/timing.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { laneLabels } from "./studio-types.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const lookaheadOptions = [2, 4, 6] as const
const pastMicros = 400_000
const contactCap = 160

type ScrollingChartPreviewProps = {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly controls?: boolean
}

export function ScrollingChartPreview({
  chart,
  music,
  playback,
  selectedTick,
  controls = true,
}: ScrollingChartPreviewProps) {
  const snapshot = usePlaybackSnapshot(playback)
  const [lookaheadSeconds, setLookaheadSeconds] = useState(4)
  const usesClock = showsPlaybackClock(snapshot.status) || snapshot.status === "ended"
  const audioMicros = usesClock ? snapshot.audioMicros : tickToAudioMicros(music, selectedTick)
  const lookaheadMicros = lookaheadSeconds * 1_000_000
  const index = useMemo(() => buildChartPreviewIndex(chart, music), [chart, music])
  const projection = useMemo(
    () =>
      projectVisibleContacts({
        index,
        audioMicros,
        pastMicros,
        lookaheadMicros,
        contactCap,
      }),
    [audioMicros, index, lookaheadMicros],
  )
  const receptorPosition = pastMicros / (pastMicros + lookaheadMicros)

  return (
    <section className="chart-preview" aria-label="Scrolling ten-lane chart preview">
      <header className="chart-preview__toolbar">
        <div>
          <strong>Approach field</strong>
          <span className="mono">
            {(audioMicros / 1_000_000).toFixed(3)} audio sec · tick{" "}
            {selectedTickLabel(snapshot.chartTick, selectedTick, usesClock)}
          </span>
        </div>
        {controls ? (
          <label>
            Lookahead
            <select
              aria-label="Preview lookahead"
              value={lookaheadSeconds}
              onChange={(event) => setLookaheadSeconds(Number(event.currentTarget.value))}
            >
              {lookaheadOptions.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} sec
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <div className="chart-preview__field">
        <div className="chart-preview__sides" aria-hidden="true">
          <span>Left pad · L</span>
          <span>Right pad · R</span>
        </div>
        <div className="chart-preview__lanes" aria-hidden="true">
          {laneIndices.map((lane) => (
            <span className={lane < 5 ? "is-left" : "is-right"} key={laneLabels[lane]} />
          ))}
        </div>
        <div className="chart-preview__receptors" aria-hidden="true">
          {laneIndices.map((lane) => (
            <span className={lane < 5 ? "is-left" : "is-right"} key={laneLabels[lane]}>
              {laneLabels[lane].slice(2)}
            </span>
          ))}
        </div>
        <div className="chart-preview__contacts">
          {projection.contacts.map((contact) => (
            <div
              aria-label={`${laneLabels[contact.lane]}, ${contact.kind}, tick ${contact.tick}${contact.kind === "hold" ? `, tail tick ${contact.tick + contact.holdTicks}` : ""}`}
              className={`chart-contact chart-contact--${contact.kind} ${contact.lane < 5 ? "is-left" : "is-right"}`}
              key={contact.key}
              role="img"
              style={{
                gridColumn: contact.lane + 1,
                transform: positionTransform(contact.headPosition, receptorPosition),
              }}
            >
              {contact.kind === "hold" ? (
                <span
                  className="chart-contact__hold"
                  style={{
                    transform: holdTransform(
                      contact.headPosition,
                      contact.tailPosition,
                      receptorPosition,
                    ),
                  }}
                />
              ) : null}
              <span className="chart-contact__head" />
              {contact.kind === "hold" ? (
                <span
                  className="chart-contact__tail"
                  style={{
                    transform: tailTransform(
                      contact.headPosition,
                      contact.tailPosition,
                      receptorPosition,
                    ),
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <p className="chart-preview__overflow" aria-live="polite">
        {projection.hiddenContactCount > 0
          ? `${projection.hiddenContactCount} additional visible contacts omitted by the rendering cap.`
          : `${projection.contacts.length} contacts in the visible audio-time window.`}
      </p>
    </section>
  )
}

function selectedTickLabel(
  chartTick: number | null,
  selectedTick: number,
  usesClock: boolean,
): string {
  if (usesClock && chartTick === null) return "pre-roll"
  return (usesClock ? (chartTick ?? 0) : selectedTick).toFixed(usesClock ? 2 : 0)
}

function displayPosition(position: number, receptorPosition: number): number {
  const receptor = 0.125
  if (position >= receptorPosition) {
    return receptor + ((position - receptorPosition) / (1 - receptorPosition)) * (1 - receptor)
  }
  return receptor * (position / receptorPosition)
}

function positionTransform(position: number, receptorPosition: number): string {
  return `translate3d(0, ${displayPosition(position, receptorPosition) * 100}%, 0)`
}

function holdTransform(
  headPosition: number,
  tailPosition: number,
  receptorPosition: number,
): string {
  const head = displayPosition(headPosition, receptorPosition)
  const tail = displayPosition(tailPosition, receptorPosition)
  const scale = Math.max(tail - head, 0.01)
  return `scaleY(${scale})`
}

function tailTransform(
  headPosition: number,
  tailPosition: number,
  receptorPosition: number,
): string {
  const head = displayPosition(headPosition, receptorPosition)
  const tail = displayPosition(tailPosition, receptorPosition)
  return `translate3d(0, ${Math.max(tail - head, 0) * 100}%, 0)`
}
