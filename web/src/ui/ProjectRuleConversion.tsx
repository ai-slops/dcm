import { useState } from "react"

import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import { convertBeatWeightedCycleToHybrid } from "../domain/project-grid.ts"
import { Button, Field } from "./primitives.tsx"

export function ProjectRuleConversion(props: {
  readonly project: GenerationProjectV2
  readonly onProject: (project: GenerationProjectV2) => void
}) {
  const [name, setName] = useState("Imported cycle")
  const [confirming, setConfirming] = useState(false)
  return (
    <section className="project-conversion" aria-labelledby="project-conversion-heading">
      <h2 id="project-conversion-heading">Visual grid conversion required</h2>
      <p>
        This V1 weighted cycle remains unchanged until you explicitly convert it. The new hybrid
        algorithm can resample generated output from the named automatic region.
      </p>
      {confirming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (props.project.generation_rules.schema_version !== 1) return
            props.onProject({
              ...props.project,
              generation_rules: convertBeatWeightedCycleToHybrid(props.project.generation_rules, {
                id: crypto.randomUUID(),
                name,
              }),
            })
            setConfirming(false)
          }}
        >
          <Field label="Converted region name">
            <input required value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </Field>
          <div className="cluster">
            <Button type="submit" variant="primary">
              Confirm conversion
            </Button>
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setConfirming(true)}>Convert to visual hybrid rules</Button>
      )}
    </section>
  )
}
