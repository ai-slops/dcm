import type { BeatChartDocument } from "../../shared/index.ts"
import { Field, Panel } from "./primitives.tsx"
import { TimingEditor } from "./TimingEditor.tsx"

type InspectorProps = {
  readonly project: BeatChartDocument
  readonly validationError: string
  readonly replaceProject: (project: BeatChartDocument) => void
}

export function Inspector(props: InspectorProps) {
  return (
    <Panel title="Chart information" className="rail-panel">
      <div className="inspector-stack">
        <Field
          label="Chart artist"
          help="Credit for the chart author, separate from the song artist."
        >
          <input
            value={props.project.chart_artist ?? ""}
            onChange={(event) =>
              props.replaceProject({
                ...props.project,
                chart_artist: event.currentTarget.value === "" ? null : event.currentTarget.value,
              })
            }
          />
        </Field>
        <Field label="Song artist" help="Managed by the song library.">
          <input readOnly value={props.project.artist} />
        </Field>
        <Field label="Audio offset" help="Signed microseconds from audio zero to beat zero.">
          <input
            className="mono"
            type="number"
            value={props.project.timing.offset_micros}
            onChange={(event) => {
              if (Number.isSafeInteger(event.currentTarget.valueAsNumber))
                props.replaceProject({
                  ...props.project,
                  timing: {
                    ...props.project.timing,
                    offset_micros: event.currentTarget.valueAsNumber,
                  },
                })
            }}
          />
        </Field>
        <TimingEditor project={props.project} replaceProject={props.replaceProject} />
        {props.validationError === "" ? null : (
          <p className="field-error" role="alert">
            Edit rejected: {props.validationError}
          </p>
        )}
      </div>
    </Panel>
  )
}
