import { useEffect, useState } from "react"

import {
  type Beat,
  type BeatNote,
  type BeatTiming,
  BeatTimingSchema,
  compareBeats,
} from "../../shared/beat.ts"
import { formatBeat, parseBeatDraft } from "../domain/beat-input.ts"
import { validateRowsPerMeasureChange } from "../domain/beat-timeline.ts"
import { Field } from "./primitives.tsx"

type ProjectInformationChange = {
  readonly chartArtist: string | null
  readonly timing: BeatTiming
}

export function ProjectInformationEditor(props: {
  readonly automaticExtent: Beat | null
  readonly chartArtist: string | null
  readonly disabled: boolean
  readonly notes: readonly BeatNote[]
  readonly songArtist: string
  readonly timing: BeatTiming
  readonly onChange: (change: ProjectInformationChange) => void
}) {
  const firstSection = props.timing.grid_sections[0]
  const [chartArtist, setChartArtist] = useState(props.chartArtist ?? "")
  const [offset, setOffset] = useState(String(props.timing.offset_micros))
  const [durationPolicy, setDurationPolicy] = useState<"automatic" | "explicit">(
    props.timing.duration === null ? "automatic" : "explicit",
  )
  const [duration, setDuration] = useState(
    props.timing.duration === null ? "" : formatBeat(props.timing.duration),
  )
  const [splitStart, setSplitStart] = useState(
    firstSection === undefined ? "0" : formatBeat(firstSection.at),
  )
  const [rowsPerMeasure, setRowsPerMeasure] = useState(String(firstSection?.rows_per_measure ?? 16))
  const [error, setError] = useState("")

  useEffect(() => {
    const section = props.timing.grid_sections[0]
    setChartArtist(props.chartArtist ?? "")
    setOffset(String(props.timing.offset_micros))
    setDurationPolicy(props.timing.duration === null ? "automatic" : "explicit")
    setDuration(props.timing.duration === null ? "" : formatBeat(props.timing.duration))
    setSplitStart(section === undefined ? "0" : formatBeat(section.at))
    setRowsPerMeasure(String(section?.rows_per_measure ?? 16))
  }, [props.chartArtist, props.timing])

  function updateTiming(candidate: unknown): void {
    const parsed = BeatTimingSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "The project timing is invalid")
      return
    }
    setError("")
    props.onChange({ chartArtist: normalizedChartArtist(chartArtist), timing: parsed.data })
  }

  function commitOffset(): void {
    const value = Number(offset)
    if (!Number.isSafeInteger(value)) {
      setError("Audio offset must be a whole number of microseconds")
      return
    }
    updateTiming({ ...props.timing, offset_micros: value })
  }

  function commitDuration(): void {
    const parsed = parseBeatDraft(duration)
    if (parsed.kind === "error") {
      setError(parsed.message)
      return
    }
    if (parsed.beat.numerator === 0) {
      setError("Explicit duration must be positive")
      return
    }
    if (props.automaticExtent !== null && compareBeats(parsed.beat, props.automaticExtent) < 0) {
      setError(
        `Explicit duration cannot truncate content ending at beat ${formatBeat(props.automaticExtent)}`,
      )
      return
    }
    updateTiming({ ...props.timing, duration: parsed.beat })
  }

  function commitSplit(): void {
    const start = parseBeatDraft(splitStart)
    const rows = Number(rowsPerMeasure)
    if (start.kind === "error") {
      setError(start.message)
      return
    }
    if (!Number.isSafeInteger(rows) || rows < 1 || rows > 512) {
      setError("Rows per four-beat measure must be a whole number from 1 through 512")
      return
    }
    const result = validateRowsPerMeasureChange(props.timing, props.notes, start.beat, rows)
    if (result.kind === "error") {
      setError(result.message)
      return
    }
    updateTiming(result.timing)
  }

  return (
    <section className="project-information" aria-labelledby="project-information-heading">
      <header>
        <h2 id="project-information-heading">Project information</h2>
        <p>Song metadata stays separate from authored chart identity and exact timing.</p>
      </header>
      <div className="project-information__grid">
        <Field label="Song artist">
          <input readOnly value={props.songArtist} />
        </Field>
        <Field label="Chart artist">
          <input
            disabled={props.disabled}
            value={chartArtist}
            onChange={(event) => setChartArtist(event.currentTarget.value)}
            onBlur={() => {
              setError("")
              props.onChange({
                chartArtist: normalizedChartArtist(chartArtist),
                timing: props.timing,
              })
            }}
          />
        </Field>
        <Field label="Audio offset (microseconds)">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            value={offset}
            onChange={(event) => setOffset(event.currentTarget.value)}
            onBlur={commitOffset}
          />
        </Field>
        <Field label="Duration policy">
          <select
            disabled={props.disabled}
            value={durationPolicy}
            onChange={(event) => {
              const policy = event.currentTarget.value === "explicit" ? "explicit" : "automatic"
              setDurationPolicy(policy)
              if (policy === "automatic") updateTiming({ ...props.timing, duration: null })
            }}
          >
            <option value="automatic">Automatic</option>
            <option value="explicit">Explicit override</option>
          </select>
        </Field>
        {durationPolicy === "automatic" ? (
          <p className="status-copy">
            {props.automaticExtent === null
              ? "Automatic · no content extent yet"
              : `Automatic · content ends at beat ${formatBeat(props.automaticExtent)}`}
          </p>
        ) : (
          <Field label="Explicit duration beat">
            <input
              className="mono"
              disabled={props.disabled}
              value={duration}
              onChange={(event) => setDuration(event.currentTarget.value)}
              onBlur={commitDuration}
            />
          </Field>
        )}
        <Field label="Split section start beat">
          <input
            className="mono"
            disabled={props.disabled}
            value={splitStart}
            onChange={(event) => setSplitStart(event.currentTarget.value)}
            onBlur={commitSplit}
          />
        </Field>
        <Field label="Split (rows per four-beat measure)">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            min={1}
            max={512}
            value={rowsPerMeasure}
            onChange={(event) => setRowsPerMeasure(event.currentTarget.value)}
            onBlur={commitSplit}
          />
        </Field>
      </div>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function normalizedChartArtist(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
