import { useId, useMemo, useState } from "react"

import type { NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import { buildChartPreviewIndex, projectVisibleContacts } from "../domain/chart-preview.ts"
import { laneTone } from "../domain/timeline.ts"
import { tickToAudioMicros } from "../domain/timing.ts"
import { showsPlaybackClock } from "./audio-playback-state.ts"
import { laneLabels } from "./studio-types.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const singleLaneIndices = [0, 1, 2, 3, 4] as const
const pastMicros = 400_000
const contactCap = 160

type ScrollingChartPreviewProps = {
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly mode?: UcsMode
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly controls?: boolean
}

export function ScrollingChartPreview({
  chart,
  music,
  mode = "Double",
  playback,
  selectedTick,
  controls = true,
}: ScrollingChartPreviewProps) {
  const snapshot = usePlaybackSnapshot(playback)
  const lookaheadId = useId()
  const exactLookaheadId = useId()
  const lookaheadErrorId = useId()
  const visibleLanes = mode === "Single" ? singleLaneIndices : laneIndices
  const [lookaheadSeconds, setLookaheadSeconds] = useState(4)
  const [lookaheadDraft, setLookaheadDraft] = useState("4")
  const [lookaheadError, setLookaheadError] = useState("")
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
  const contacts = projection.contacts.filter((contact) => contact.lane < visibleLanes.length)
  const hiddenContactCount =
    projection.hiddenContactCount + projection.contacts.length - contacts.length
  const receptorPosition = pastMicros / (pastMicros + lookaheadMicros)

  return (
    <section
      className={`chart-preview chart-preview--${mode.toLowerCase()}`}
      aria-label={`Scrolling ${visibleLanes.length}-lane ${mode} chart preview`}
    >
      <header className="chart-preview__toolbar">
        <div>
          <strong>Approach field</strong>
          <span className="mono">
            {(audioMicros / 1_000_000).toFixed(3)} audio sec · tick{" "}
            {selectedTickLabel(snapshot.chartTick, selectedTick, usesClock)}
          </span>
        </div>
        {controls ? (
          <div className="chart-preview__lookahead">
            <label htmlFor={lookaheadId}>Lookahead range</label>
            <input
              id={lookaheadId}
              aria-label="Preview lookahead range"
              type="range"
              min="0.1"
              max="12"
              step="0.05"
              value={lookaheadSeconds}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber
                setLookaheadSeconds(next)
                setLookaheadDraft(String(next))
                setLookaheadError("")
              }}
            />
            <label htmlFor={exactLookaheadId}>Exact seconds</label>
            <input
              id={exactLookaheadId}
              className="mono chart-preview__exact-input"
              aria-label="Exact preview lookahead seconds"
              aria-describedby={lookaheadError === "" ? undefined : lookaheadErrorId}
              aria-invalid={lookaheadError === "" ? undefined : true}
              type="number"
              min="0.1"
              max="12"
              step="0.05"
              value={lookaheadDraft}
              onChange={(event) => {
                const draft = event.currentTarget.value
                setLookaheadDraft(draft)
                const parsed = parseLookaheadDraft(draft)
                if (parsed.kind === "valid") {
                  setLookaheadSeconds(parsed.value)
                  setLookaheadError("")
                } else setLookaheadError(parsed.message)
              }}
            />
            {lookaheadError === "" ? null : (
              <span className="field-error" id={lookaheadErrorId} role="alert">
                {lookaheadError}
              </span>
            )}
          </div>
        ) : null}
      </header>
      <div className="chart-preview__field">
        <div className="chart-preview__sides" aria-hidden="true">
          <span>Left pad · L</span>
          {mode === "Double" ? <span>Right pad · R</span> : null}
        </div>
        <div className="chart-preview__lanes" aria-hidden="true">
          {visibleLanes.map((lane) => (
            <span data-tone={laneTone(lane)} key={laneLabels[lane]} />
          ))}
        </div>
        <div className="chart-preview__receptors" aria-hidden="true">
          {visibleLanes.map((lane) => (
            <span data-tone={laneTone(lane)} key={laneLabels[lane]}>
              {laneLabels[lane].slice(2)}
            </span>
          ))}
        </div>
        <div className="chart-preview__contacts">
          {contacts.map((contact) => (
            <div
              aria-label={`${laneLabels[contact.lane]}, ${contact.kind}, tick ${contact.tick}${contact.kind === "hold" ? `, tail tick ${contact.tick + contact.holdTicks}` : ""}`}
              className={`chart-contact chart-contact--${contact.kind}`}
              data-tone={laneTone(contact.lane)}
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
        {hiddenContactCount > 0
          ? `${hiddenContactCount} additional visible contacts omitted by mode or rendering cap.`
          : `${contacts.length} contacts in the visible audio-time window.`}
      </p>
    </section>
  )
}

export function parseLookaheadDraft(
  draft: string,
):
  | { readonly kind: "valid"; readonly value: number }
  | { readonly kind: "invalid"; readonly message: string } {
  if (draft.trim() === "") return { kind: "invalid", message: "Enter lookahead seconds." }
  const value = Number(draft)
  if (!Number.isFinite(value) || value < 0.1 || value > 12)
    return { kind: "invalid", message: "Use a finite value from 0.1 to 12 seconds." }
  const nearestStep = 0.1 + Math.round((value - 0.1) / 0.05) * 0.05
  if (Math.abs(nearestStep - value) > 1e-9)
    return { kind: "invalid", message: "Use increments of 0.05 seconds." }
  return { kind: "valid", value }
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
