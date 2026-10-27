import { useState } from "react"

import type { GenerationProject, MusicTiming } from "../../shared/generation-projects.ts"
import { extendProjectTail } from "../domain/project-grid.ts"
import { Button, Field } from "./primitives.tsx"

export function ProjectTailEditor(props: {
  readonly disabled: boolean
  readonly project: GenerationProject
  readonly template: MusicTiming
  readonly onChange: (project: GenerationProject) => void
}) {
  const [additionalTicks, setAdditionalTicks] = useState("")
  const [tailBpm, setTailBpm] = useState("")
  const [error, setError] = useState("")
  return (
    <section className="project-tail" aria-labelledby="project-tail-heading">
      <header>
        <h2 id="project-tail-heading">Timing span</h2>
        <p>
          ZIP template: {props.template.duration_ticks} ticks at {props.template.ticks_per_beat}{" "}
          ticks per beat. Current project: {props.project.timing.duration_ticks} ticks.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const result = extendProjectTail(props.project, { additionalTicks, tailBpm })
          if (result.kind === "error") {
            setError(result.message)
            return
          }
          props.onChange(result.project)
          setAdditionalTicks("")
          setTailBpm("")
          setError("")
        }}
      >
        <Field label="Additional ticks" help="Positive whole ticks appended after the current end.">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={additionalTicks}
            onChange={(event) => setAdditionalTicks(event.currentTarget.value)}
          />
        </Field>
        <Field
          label="Optional tail BPM"
          help="Adds an exact tempo marker at the old end only when it differs from the active tempo."
        >
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="decimal"
            placeholder="Keep active tempo"
            value={tailBpm}
            onChange={(event) => setTailBpm(event.currentTarget.value)}
          />
        </Field>
        <div className="cluster">
          <Button type="submit" disabled={props.disabled}>
            Add tail
          </Button>
          <Button
            type="button"
            disabled={props.disabled || (additionalTicks === "" && tailBpm === "")}
            onClick={() => {
              setAdditionalTicks("")
              setTailBpm("")
              setError("")
            }}
          >
            Clear tail fields
          </Button>
        </div>
      </form>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
