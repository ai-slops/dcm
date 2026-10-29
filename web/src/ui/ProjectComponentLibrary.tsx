import { useState } from "react"

import type { BeatProjectWorkspace } from "../../shared/beat-projects.ts"
import type { ComponentKind, GenerationProjectId } from "../../shared/project-identities.ts"
import { Button } from "./primitives.tsx"

type ProjectComponentLibraryProps = {
  readonly busy: boolean
  readonly rulesDirty: boolean
  readonly workspace: BeatProjectWorkspace
  readonly selectedProjectId: GenerationProjectId | null
  readonly onPublish: (kind: ComponentKind, name: string) => void
  readonly onApply: (componentId: BeatProjectWorkspace["components"][number]["id"]) => void
  readonly onDelete: (component: BeatProjectWorkspace["components"][number]) => void
}

export function ProjectComponentLibrary(props: ProjectComponentLibraryProps) {
  const [kind, setKind] = useState<ComponentKind>("timing")
  const [name, setName] = useState("")
  return (
    <section className="project-component-library" aria-labelledby="components-heading">
      <div className="library-section__heading">
        <h3 id="components-heading">Reusable components</h3>
        <p className="status-copy">
          Publish timing, evaluation, or generator data and apply it with revision checks.
        </p>
        {props.rulesDirty ? (
          <p className="status-copy">
            Save project rules before publishing or applying components.
          </p>
        ) : null}
      </div>
      <form
        className="library-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.rulesDirty) props.onPublish(kind, name)
        }}
      >
        <label>
          Component kind
          <select
            value={kind}
            onChange={(event) => setKind(componentKind(event.currentTarget.value))}
          >
            <option value="timing">Timing</option>
            <option value="evaluation">Evaluation</option>
            <option value="generator">Generator</option>
          </select>
        </label>
        <label>
          Component name
          <input required value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <Button
          type="submit"
          disabled={props.busy || props.selectedProjectId === null || props.rulesDirty}
        >
          Publish
        </Button>
      </form>
      {props.workspace.components.length === 0 ? (
        <p className="status-copy">No reusable components yet.</p>
      ) : (
        <ul className="project-component-list">
          {props.workspace.components.map((component) => (
            <li key={component.id}>
              <span>
                <strong>{component.name}</strong>
                <small>
                  {component.kind} · revision {component.revision}
                </small>
              </span>
              <div className="cluster">
                <Button
                  disabled={
                    props.busy ||
                    props.selectedProjectId === null ||
                    props.rulesDirty ||
                    component.kind === "legacy_unresolved" ||
                    component.kind === "note_fragment"
                  }
                  onClick={() => props.onApply(component.id)}
                >
                  Apply
                </Button>
                <Button
                  variant="danger"
                  disabled={props.busy}
                  onClick={() => props.onDelete(component)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function componentKind(value: string): ComponentKind {
  if (value === "evaluation") return "evaluation"
  if (value === "generator") return "generator"
  return "timing"
}
