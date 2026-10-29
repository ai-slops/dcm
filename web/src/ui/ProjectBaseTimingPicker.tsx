import type { BaseUcsRef } from "../../shared/beat.ts"
import type { BaseUcsSourceOption } from "../../shared/beat-projects.ts"
import { Field } from "./primitives.tsx"

export type BaseTimingSourceOption = Pick<BaseUcsSourceOption, "label" | "ref">

export function ProjectBaseTimingPicker(props: {
  readonly disabled: boolean
  readonly options: readonly BaseTimingSourceOption[]
  readonly selected: BaseUcsRef | null
  readonly onSelect: (option: BaseTimingSourceOption) => void
}) {
  return (
    <Field
      label="Base timing source"
      help="Choose an archive UCS entry, retained original timing, or stored chart. Offset, tempo, split, and accents are copied exactly; duration starts automatic."
    >
      <select
        disabled={props.disabled}
        required
        value={props.selected === null ? "" : sourceKey(props.selected)}
        onChange={(event) => {
          const option = props.options.find(
            (candidate) => sourceKey(candidate.ref) === event.currentTarget.value,
          )
          if (option !== undefined) props.onSelect(option)
        }}
      >
        <option value="">Choose exact base timing</option>
        {props.options.map((option) => (
          <option value={sourceKey(option.ref)} key={sourceKey(option.ref)}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function sourceKey(source: BaseUcsRef): string {
  switch (source.source) {
    case "archive_entry":
      return `archive:${source.archive_id}:${source.entry_name}`
    case "saved_chart":
      return `chart:${source.chart_id}`
    case "retained_timing":
      return `retained:${source.song_id}`
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}
