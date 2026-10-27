import { useState } from "react"
import type { Revision } from "../../shared/index.ts"
import type { LibraryChart, LibrarySnapshot } from "../../shared/library.ts"
import type { LibraryCommand } from "../../shared/library-commands.ts"
import { Badge, Button } from "./primitives.tsx"

type LibraryChartListProps = {
  readonly busy: boolean
  readonly charts: readonly LibraryChart[]
  readonly documentRevision: Revision
  readonly library: LibrarySnapshot
  readonly onCommand: (command: LibraryCommand) => void
  readonly onDelete: (chart: LibraryChart) => void
}

function LibraryChartRow(
  props: Omit<LibraryChartListProps, "charts"> & { readonly chart: LibraryChart },
) {
  const [name, setName] = useState(props.chart.name)
  const active = props.chart.id === props.library.active_chart_id
  return (
    <article className="library-chart-row" data-chart-id={props.chart.id}>
      <div>
        <strong>{props.chart.name}</strong>
        <small>
          {props.chart.mode} · {props.chart.note_count} notes · {props.chart.hold_count} holds
        </small>
      </div>
      <form
        className="library-chart-rename"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCommand({
            type: "rename_chart",
            library_revision: props.library.revision,
            chart_id: props.chart.id,
            name,
          })
        }}
      >
        <input
          aria-label={`Rename ${props.chart.name}`}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={props.busy || name === props.chart.name}>
          Rename
        </Button>
      </form>
      <div className="cluster">
        {active ? <Badge tone="success">Active</Badge> : null}
        <Button
          disabled={props.busy || active}
          onClick={() =>
            props.onCommand({
              type: "open_chart",
              library_revision: props.library.revision,
              base_revision: props.documentRevision,
              chart_id: props.chart.id,
            })
          }
        >
          Open
        </Button>
        <Button
          disabled={props.busy}
          onClick={() =>
            props.onCommand({
              type: "duplicate_chart",
              library_revision: props.library.revision,
              chart_id: props.chart.id,
              name: `${props.chart.name} copy`,
            })
          }
        >
          Duplicate
        </Button>
        {props.busy || props.chart.generated_from === undefined ? null : (
          <a className="button" href={`/projects/${props.chart.generated_from.project_id}/edit`}>
            Edit grid
          </a>
        )}
        <Button
          variant="danger"
          disabled={props.busy || props.library.charts.length === 1}
          onClick={() => props.onDelete(props.chart)}
        >
          Delete
        </Button>
      </div>
    </article>
  )
}

export function LibraryChartList(props: LibraryChartListProps) {
  return (
    <ul className="library-chart-list" aria-label="Saved charts">
      {props.charts.map((chart) => (
        <li key={chart.id}>
          <LibraryChartRow {...props} chart={chart} />
        </li>
      ))}
    </ul>
  )
}
