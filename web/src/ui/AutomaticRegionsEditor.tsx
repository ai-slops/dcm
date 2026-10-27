import { useEffect, useState } from "react"

import {
  type AutomaticRegion,
  AutomaticRegionSchema,
  type HybridRules,
  HybridRulesSchema,
} from "../../shared/generation-rules.ts"
import { Button, Field } from "./primitives.tsx"

const defaultPattern = JSON.stringify(
  [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
  null,
  2,
)

type RegionDraft = {
  readonly name: string
  readonly startTick: string
  readonly endTick: string
  readonly stepTicks: string
  readonly pattern: string
}

const emptyDraft: RegionDraft = {
  name: "",
  startTick: "0",
  endTick: "",
  stepTicks: "1",
  pattern: defaultPattern,
}

function draftFor(region: AutomaticRegion): RegionDraft {
  return {
    name: region.name,
    startTick: String(region.rules.start_tick),
    endTick: String(region.rules.end_tick),
    stepTicks: String(region.rules.step_ticks),
    pattern: JSON.stringify(region.rules.pattern, null, 2),
  }
}

function parseRegion(id: string, draft: RegionDraft): AutomaticRegion {
  return AutomaticRegionSchema.parse({
    id,
    name: draft.name,
    rules: {
      start_tick: Number(draft.startTick),
      end_tick: Number(draft.endTick),
      step_ticks: Number(draft.stepTicks),
      pattern: JSON.parse(draft.pattern),
    },
  })
}

function RegionForm(props: {
  readonly disabled: boolean
  readonly initial: RegionDraft
  readonly label: string
  readonly submitLabel: string
  readonly onSubmit: (draft: RegionDraft) => void
  readonly onClear?: () => void
}) {
  const [draft, setDraft] = useState(props.initial)
  const { name, startTick, endTick, stepTicks, pattern } = props.initial
  useEffect(
    () => setDraft({ name, startTick, endTick, stepTicks, pattern }),
    [endTick, name, pattern, startTick, stepTicks],
  )
  return (
    <form
      className="project-region-form"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit(draft)
      }}
    >
      <h3>{props.label}</h3>
      <div className="project-region-form__grid">
        <Field label="Region name">
          <input
            disabled={props.disabled}
            required
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          />
        </Field>
        <Field label="Start tick">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.startTick}
            onChange={(event) => setDraft({ ...draft, startTick: event.currentTarget.value })}
          />
        </Field>
        <Field label="End tick">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.endTick}
            onChange={(event) => setDraft({ ...draft, endTick: event.currentTarget.value })}
          />
        </Field>
        <Field label="Step ticks">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.stepTicks}
            onChange={(event) => setDraft({ ...draft, stepTicks: event.currentTarget.value })}
          />
        </Field>
      </div>
      <Field
        label={`${props.label} pattern JSON`}
        help="Each slot contains one or more weighted panel choices."
      >
        <textarea
          className="mono project-region-pattern"
          disabled={props.disabled}
          rows={6}
          spellCheck={false}
          value={draft.pattern}
          onChange={(event) => setDraft({ ...draft, pattern: event.currentTarget.value })}
        />
      </Field>
      <div className="cluster">
        <Button type="submit" disabled={props.disabled}>
          {props.submitLabel}
        </Button>
        {props.onClear === undefined ? null : (
          <Button type="button" variant="danger" disabled={props.disabled} onClick={props.onClear}>
            Clear {props.label.toLowerCase()}
          </Button>
        )}
      </div>
    </form>
  )
}

export function AutomaticRegionsEditor(props: {
  readonly disabled: boolean
  readonly rules: HybridRules
  readonly onChange: (rules: HybridRules) => void
}) {
  const [error, setError] = useState("")

  function commit(regions: readonly AutomaticRegion[]): void {
    const parsed = HybridRulesSchema.safeParse({ ...props.rules, regions })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "The automatic regions are invalid")
      return
    }
    setError("")
    props.onChange(parsed.data)
  }

  return (
    <section
      className="project-regions"
      id="automatic-regions"
      aria-labelledby="automatic-regions-heading"
    >
      <header>
        <h2 id="automatic-regions-heading">Automatic regions</h2>
        <p>
          Named ranges are generated when you create an output. Fixed notes remain outside them.
        </p>
      </header>
      {props.rules.regions.map((region, index) => (
        <RegionForm
          key={region.id}
          disabled={props.disabled}
          initial={draftFor(region)}
          label={region.name}
          submitLabel="Update region"
          onSubmit={(draft) => {
            try {
              const next = [...props.rules.regions]
              next[index] = parseRegion(region.id, draft)
              commit(next)
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "The region is invalid")
            }
          }}
          onClear={() =>
            commit(props.rules.regions.filter((candidate) => candidate.id !== region.id))
          }
        />
      ))}
      <RegionForm
        disabled={props.disabled}
        initial={emptyDraft}
        label="New region"
        submitLabel="Add region"
        onSubmit={(draft) => {
          try {
            commit([...props.rules.regions, parseRegion(crypto.randomUUID(), draft)])
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "The region is invalid")
          }
        }}
      />
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
