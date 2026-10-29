import { useEffect, useState } from "react"
import type { z } from "zod"

import { BeatAutomaticRegionSchema, BeatHybridRulesSchema } from "../../shared/beat-rules.ts"
import { formatBeat, parseBeatDraft } from "../domain/beat-input.ts"
import { Button, Field } from "./primitives.tsx"

const defaultPattern = JSON.stringify(
  [
    {
      choices: [{ panel_mask: 1, hold: { numerator: 0, denominator: 1 }, weight: 1 }],
    },
  ],
  null,
  2,
)

type RegionDraft = {
  readonly name: string
  readonly start: string
  readonly end: string
  readonly step: string
  readonly pattern: string
}

const emptyDraft: RegionDraft = {
  name: "",
  start: "0",
  end: "",
  step: "1",
  pattern: defaultPattern,
}

type AutomaticRegion = z.infer<typeof BeatAutomaticRegionSchema>

function draftFor(region: AutomaticRegion): RegionDraft {
  return {
    name: region.name,
    start: formatBeat(region.rules.start),
    end: formatBeat(region.rules.end),
    step: formatBeat(region.rules.step),
    pattern: JSON.stringify(region.rules.pattern, null, 2),
  }
}

function parseRegion(id: string, draft: RegionDraft): AutomaticRegion {
  const start = parseBeatDraft(draft.start)
  const end = parseBeatDraft(draft.end)
  const step = parseBeatDraft(draft.step)
  const invalid = [start, end, step].find((result) => result.kind === "error")
  if (invalid?.kind === "error") throw new RegionDraftError(invalid.message)
  if (start.kind !== "success" || end.kind !== "success" || step.kind !== "success")
    throw new RegionDraftError("Enter exact region beats")
  return BeatAutomaticRegionSchema.parse({
    id,
    name: draft.name,
    rules: {
      start: start.beat,
      end: end.beat,
      step: step.beat,
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
  const { name, start, end, step, pattern } = props.initial
  useEffect(() => setDraft({ name, start, end, step, pattern }), [end, name, pattern, start, step])
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
        <Field label="Start beat">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.start}
            onChange={(event) => setDraft({ ...draft, start: event.currentTarget.value })}
          />
        </Field>
        <Field label="End beat (exclusive)">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.end}
            onChange={(event) => setDraft({ ...draft, end: event.currentTarget.value })}
          />
        </Field>
        <Field label="Step beat">
          <input
            className="mono"
            disabled={props.disabled}
            inputMode="numeric"
            required
            value={draft.step}
            onChange={(event) => setDraft({ ...draft, step: event.currentTarget.value })}
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
  readonly rules: z.infer<typeof BeatHybridRulesSchema>
  readonly onChange: (rules: z.infer<typeof BeatHybridRulesSchema>) => void
}) {
  const [error, setError] = useState("")

  function commit(regions: readonly AutomaticRegion[]): void {
    const parsed = BeatHybridRulesSchema.safeParse({ ...props.rules, regions })
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

class RegionDraftError extends Error {
  override readonly name = "RegionDraftError"
}
