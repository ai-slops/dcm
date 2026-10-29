import { useEffect, useState } from "react"

import type { BeatChartDocument } from "../../shared/index.ts"
import { formatBeat } from "../domain/beat-timeline.ts"
import {
  addTempoMarker,
  type BeatDocumentEditResult,
  bpmInputValue,
  removeTempoMarker,
  setBeatDuration,
  updateTempoMarker,
} from "../domain/beat-timing-inputs.ts"
import { Button, Field } from "./primitives.tsx"

type TimingEditorProps = {
  readonly project: BeatChartDocument
  readonly replaceProject: (project: BeatChartDocument) => void
}

export function TimingEditor(props: TimingEditorProps) {
  const [duration, setDuration] = useState(
    props.project.timing.duration === null ? "" : formatBeat(props.project.timing.duration),
  )
  const [newAt, setNewAt] = useState("")
  const [newBpm, setNewBpm] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    setDuration(
      props.project.timing.duration === null ? "" : formatBeat(props.project.timing.duration),
    )
  }, [props.project.timing.duration])

  function commit(result: BeatDocumentEditResult): void {
    if (result.kind === "error") {
      setError(result.message)
      return
    }
    setError("")
    props.replaceProject(result.project)
  }

  return (
    <section className="inspector-stack" aria-label="Beat timing">
      <form
        className="inspector-stack"
        onSubmit={(event) => {
          event.preventDefault()
          commit(setBeatDuration(props.project, duration))
        }}
      >
        <Field
          label="Explicit duration"
          help="Exact beat fraction. Leave empty for automatic extent."
        >
          <input
            className="mono"
            inputMode="text"
            placeholder="Automatic"
            value={duration}
            onChange={(event) => setDuration(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit">Set duration policy</Button>
      </form>
      {props.project.timing.tempo.map((segment, index) => (
        <TempoRow
          key={`${segment.at.numerator}/${segment.at.denominator}`}
          index={index}
          at={formatBeat(segment.at)}
          bpm={bpmInputValue(segment.micros_per_beat)}
          onUpdate={(at, bpm) => commit(updateTempoMarker(props.project, index, at, bpm))}
          onRemove={() => commit(removeTempoMarker(props.project, index))}
        />
      ))}
      <form
        className="inspector-stack"
        onSubmit={(event) => {
          event.preventDefault()
          const result = addTempoMarker(props.project, newAt, newBpm)
          commit(result)
          if (result.kind === "success") {
            setNewAt("")
            setNewBpm("")
          }
        }}
      >
        <strong>Add tempo change</strong>
        <Field label="Marker beat">
          <input
            className="mono"
            value={newAt}
            onChange={(event) => setNewAt(event.currentTarget.value)}
          />
        </Field>
        <Field label="Marker BPM">
          <input
            className="mono"
            inputMode="decimal"
            value={newBpm}
            onChange={(event) => setNewBpm(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit">Add marker</Button>
      </form>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          Timing edit rejected: {error}
        </p>
      )}
    </section>
  )
}

function TempoRow(props: {
  readonly index: number
  readonly at: string
  readonly bpm: string
  readonly onUpdate: (at: string, bpm: string) => void
  readonly onRemove: () => void
}) {
  const [at, setAt] = useState(props.at)
  const [bpm, setBpm] = useState(props.bpm)
  useEffect(() => {
    setAt(props.at)
    setBpm(props.bpm)
  }, [props.at, props.bpm])
  return (
    <form
      className="inspector-stack"
      onSubmit={(event) => {
        event.preventDefault()
        props.onUpdate(at, bpm)
      }}
    >
      <strong>Tempo marker {props.index + 1}</strong>
      <Field
        label="Start beat"
        {...(props.index === 0 ? { help: "The base marker stays at beat zero." } : {})}
      >
        <input
          className="mono"
          disabled={props.index === 0}
          value={at}
          onChange={(event) => setAt(event.currentTarget.value)}
        />
      </Field>
      <Field label="BPM">
        <input
          className="mono"
          inputMode="decimal"
          value={bpm}
          onChange={(event) => setBpm(event.currentTarget.value)}
        />
      </Field>
      <div className="cluster">
        <Button type="submit">Update marker</Button>
        {props.index === 0 ? null : (
          <Button type="button" variant="danger" onClick={props.onRemove}>
            Remove marker
          </Button>
        )}
      </div>
    </form>
  )
}
