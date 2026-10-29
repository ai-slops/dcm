import { useState } from "react"

import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { ProjectCommand, ProjectGenerationResult } from "../../shared/project-commands.ts"
import { Button } from "./primitives.tsx"

type ProjectOperationsProps = {
  readonly busy: boolean
  readonly rulesDirty: boolean
  readonly project: GenerationProjectV2 | null
  readonly generation: ProjectGenerationResult | null
  readonly onCommand: (command: ProjectCommand) => void
  readonly onOpen: () => void
}

export function ProjectOperations(props: ProjectOperationsProps) {
  const [name, setName] = useState("Generated chart")
  const [seed, setSeed] = useState("0".repeat(64))
  return (
    <section className="project-operations" aria-labelledby="project-generate-heading">
      <div className="library-section__heading">
        <h3 id="project-generate-heading">Generate and assess</h3>
        {props.rulesDirty ? (
          <p className="status-copy">Save project rules before generating a chart.</p>
        ) : null}
      </div>
      <form
        className="library-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (props.project !== null && !props.rulesDirty)
            props.onCommand({
              type: "generate_project",
              project_id: props.project.id,
              base_revision: props.project.revision,
              name,
              seed,
            })
        }}
      >
        <label>
          Chart name
          <input required value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <label>
          64-character hex seed
          <input
            className="mono"
            required
            pattern="[0-9a-f]{64}"
            value={seed}
            onChange={(event) => setSeed(event.currentTarget.value)}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy || props.project === null || props.rulesDirty}
        >
          Generate
        </Button>
      </form>
      {props.generation === null ? null : (
        <div className="project-generation-result">
          <strong>
            {props.generation.assessment.accepted
              ? "Accepted by finite model"
              : "Rejected by finite model"}
          </strong>
          <span>
            {props.generation.chart.notes.length} notes ·{" "}
            {props.generation.assessment.rejections.length} rejections · {props.generation.mode}
          </span>
          <span>Saved as chart {props.generation.chart_id}</span>
          <Button onClick={props.onOpen}>Open generated chart</Button>
        </div>
      )}
    </section>
  )
}
