import { useState } from "react"

import type { ProjectGenerationResult } from "../../shared/project-commands.ts"
import { Button } from "./primitives.tsx"

export function ProjectGeneratePanel(props: {
  readonly busy: boolean
  readonly dirty: boolean
  readonly generation: ProjectGenerationResult | null
  readonly onGenerate: (name: string, seed: string) => void
}) {
  const [name, setName] = useState("Generated chart")
  const [seed, setSeed] = useState("0".repeat(64))
  return (
    <section className="project-grid-generate" aria-labelledby="project-grid-generate-heading">
      <header>
        <h2 id="project-grid-generate-heading">Generate output</h2>
        <p>Generation saves a new inactive chart. It never replaces the active Studio document.</p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          props.onGenerate(name, seed)
        }}
      >
        <label>
          Chart name
          <input
            disabled={props.busy}
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          64-character hex seed
          <input
            className="mono"
            disabled={props.busy}
            required
            pattern="[0-9a-f]{64}"
            value={seed}
            onChange={(event) => setSeed(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={props.busy || props.dirty}>
          Generate saved chart
        </Button>
      </form>
      {props.dirty ? <p className="status-copy">Save project rules before generating.</p> : null}
      {props.generation === null ? null : (
        <div className="project-generation-result" role="status">
          <strong>
            {props.generation.assessment.accepted
              ? "Accepted by finite model"
              : "Rejected by finite model"}
          </strong>
          <span>{props.generation.chart.notes.length} notes saved as a new inactive chart.</span>
          <a className="button" href={`/previews?chart=${props.generation.chart_id}`}>
            View generated chart
          </a>
        </div>
      )}
    </section>
  )
}
