import { useState } from "react"
import type { Beat } from "../../shared/beat.ts"
import type { BeatReusableComponent } from "../../shared/beat-projects.ts"
import type { ComponentId } from "../../shared/project-identities.ts"
import { formatBeat, parseBeatDraft } from "../domain/beat-input.ts"
import { Button, Field } from "./primitives.tsx"

type PublishFragmentInput = {
  readonly name: string
  readonly start: Beat
  readonly end: Beat
}

export function ProjectFragmentLibrary(props: {
  readonly busy: boolean
  readonly components: readonly BeatReusableComponent[]
  readonly onPublish: (input: PublishFragmentInput) => void
  readonly onApply: (componentId: ComponentId, anchor: Beat) => void
}) {
  const fragments = props.components.filter((component) => component.kind === "note_fragment")
  const [name, setName] = useState("")
  const [rangeStart, setRangeStart] = useState("0")
  const [rangeEnd, setRangeEnd] = useState("")
  const [componentId, setComponentId] = useState<ComponentId | "">("")
  const [anchor, setAnchor] = useState("0")
  const [error, setError] = useState("")

  function publish(): void {
    const start = parseBeatDraft(rangeStart)
    const end = parseBeatDraft(rangeEnd)
    if (start.kind === "error" || end.kind === "error") {
      setError(start.kind === "error" ? start.message : end.kind === "error" ? end.message : "")
      return
    }
    if (name.trim() === "") {
      setError("Enter a fragment name")
      return
    }
    setError("")
    props.onPublish({ name: name.trim(), start: start.beat, end: end.beat })
  }

  function apply(): void {
    const parsedAnchor = parseBeatDraft(anchor)
    if (parsedAnchor.kind === "error") {
      setError(parsedAnchor.message)
      return
    }
    if (componentId === "") {
      setError("Choose a note fragment")
      return
    }
    setError("")
    props.onApply(componentId, parsedAnchor.beat)
  }

  return (
    <section className="project-fragments" aria-labelledby="project-fragments-heading">
      <header>
        <h2 id="project-fragments-heading">Reusable note fragments</h2>
        <p>Publish notes in an exact beat range and apply them at a destination beat.</p>
      </header>
      <form
        className="project-fragment-form"
        onSubmit={(event) => {
          event.preventDefault()
          publish()
        }}
      >
        <Field label="Fragment name">
          <input
            disabled={props.busy}
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field label="Range start beat">
          <input
            className="mono"
            disabled={props.busy}
            required
            value={rangeStart}
            onChange={(event) => setRangeStart(event.currentTarget.value)}
          />
        </Field>
        <Field label="Range end beat (exclusive)">
          <input
            className="mono"
            disabled={props.busy}
            required
            value={rangeEnd}
            onChange={(event) => setRangeEnd(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" disabled={props.busy}>
          Publish note fragment
        </Button>
      </form>
      {fragments.length === 0 ? (
        <p className="status-copy">No note fragments published yet.</p>
      ) : (
        <ul className="project-fragment-list">
          {fragments.map((fragment) => (
            <li key={fragment.id}>
              <strong>{fragment.name}</strong>
              <span className="mono">
                {formatBeat(fragment.value.span)} beats · {fragment.value.notes.length} notes
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="project-fragment-form"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <Field label="Note fragment">
          <select
            disabled={props.busy || fragments.length === 0}
            required
            value={componentId}
            onChange={(event) => {
              const match = fragments.find((fragment) => fragment.id === event.currentTarget.value)
              setComponentId(match?.id ?? "")
            }}
          >
            <option value="">Choose fragment</option>
            {fragments.map((fragment) => (
              <option key={fragment.id} value={fragment.id}>
                {fragment.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Apply anchor beat">
          <input
            className="mono"
            disabled={props.busy}
            required
            value={anchor}
            onChange={(event) => setAnchor(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" disabled={props.busy || fragments.length === 0}>
          Apply note fragment
        </Button>
      </form>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
