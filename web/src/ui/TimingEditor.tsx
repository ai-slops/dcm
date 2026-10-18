import { useEffect, useState } from "react"

import type { Fraction, StudioProjectV1 } from "../../shared/index.ts"
import {
  addTempoChange,
  bpmInputValue,
  editTempoChange,
  removeTempoChange,
  setChartDuration,
  type TimingEditResult,
} from "../domain/timing-inputs.ts"
import { Button, Field } from "./primitives.tsx"

type TimingEditorProps = {
  readonly project: StudioProjectV1
  readonly replaceProject: (project: StudioProjectV1) => void
}

type TempoRowProps = {
  readonly project: StudioProjectV1
  readonly index: number
  readonly startTick: number
  readonly microsPerBeat: Fraction
  readonly commit: (result: TimingEditResult) => void
}

function TempoRow(props: TempoRowProps) {
  const [tickInput, setTickInput] = useState(String(props.startTick))
  const [bpmInput, setBpmInput] = useState(() => bpmInputValue(props.microsPerBeat))

  useEffect(() => {
    setTickInput(String(props.startTick))
    setBpmInput(bpmInputValue(props.microsPerBeat))
  }, [props.startTick, props.microsPerBeat])

  return (
    <form
      className="inspector-stack"
      onSubmit={(event) => {
        event.preventDefault()
        props.commit(
          editTempoChange(props.project, {
            originalTick: props.startTick,
            tick: tickInput,
            bpm: bpmInput,
          }),
        )
      }}
    >
      <strong>Tempo marker {props.index + 1}</strong>
      <Field
        label="Start tick"
        {...(props.startTick === 0 ? { help: "The base marker must stay at tick 0." } : {})}
      >
        <input
          className="mono"
          disabled={props.startTick === 0}
          inputMode="numeric"
          value={tickInput}
          onChange={(event) => setTickInput(event.currentTarget.value)}
        />
      </Field>
      <Field
        label={props.startTick === 0 ? "Base BPM" : "BPM"}
        help={`Stored exactly as ${props.microsPerBeat.numerator}/${props.microsPerBeat.denominator} microseconds per beat.`}
      >
        <input
          className="mono"
          inputMode="decimal"
          value={bpmInput}
          onChange={(event) => setBpmInput(event.currentTarget.value)}
        />
      </Field>
      <div className="cluster">
        <Button type="submit">Update marker</Button>
        {props.startTick === 0 ? null : (
          <Button
            type="button"
            variant="danger"
            onClick={() => props.commit(removeTempoChange(props.project, props.startTick))}
          >
            Remove marker
          </Button>
        )}
      </div>
    </form>
  )
}

export function TimingEditor(props: TimingEditorProps) {
  const [durationInput, setDurationInput] = useState(String(props.project.chart.span_ticks))
  const [newTickInput, setNewTickInput] = useState("")
  const [newBpmInput, setNewBpmInput] = useState("")
  const [error, setError] = useState("")

  useEffect(
    () => setDurationInput(String(props.project.chart.span_ticks)),
    [props.project.chart.span_ticks],
  )

  function commit(result: TimingEditResult): void {
    if (result.kind === "error") {
      setError(result.message)
      return
    }
    setError("")
    props.replaceProject(result.project)
  }

  return (
    <section className="inspector-stack" aria-label="Chart timing">
      <form
        className="inspector-stack"
        onSubmit={(event) => {
          event.preventDefault()
          commit(setChartDuration(props.project, durationInput))
        }}
      >
        <Field label="Chart duration" help="Ticks. Updates music duration and chart span together.">
          <input
            className="mono"
            inputMode="numeric"
            value={durationInput}
            onChange={(event) => setDurationInput(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit">Set duration</Button>
      </form>
      {props.project.music.tempo.map((segment, index) => (
        <TempoRow
          commit={commit}
          index={index}
          key={segment.start_tick}
          microsPerBeat={segment.micros_per_beat}
          project={props.project}
          startTick={segment.start_tick}
        />
      ))}
      <form
        className="inspector-stack"
        onSubmit={(event) => {
          event.preventDefault()
          const result = addTempoChange(props.project, newTickInput, newBpmInput)
          commit(result)
          if (result.kind === "success") {
            setNewTickInput("")
            setNewBpmInput("")
          }
        }}
      >
        <strong>Add tempo change</strong>
        <Field label="New marker tick">
          <input
            className="mono"
            inputMode="numeric"
            value={newTickInput}
            onChange={(event) => setNewTickInput(event.currentTarget.value)}
          />
        </Field>
        <Field label="New marker BPM" help="Positive, up to 1000, with at most 6 decimal places.">
          <input
            className="mono"
            inputMode="decimal"
            value={newBpmInput}
            onChange={(event) => setNewBpmInput(event.currentTarget.value)}
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
