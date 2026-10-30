import type { BeatNote } from "../../shared/index.ts"
import { formatBeat } from "../domain/beat-timeline.ts"

export function TimelineNoteList(props: { readonly notes: readonly BeatNote[] }) {
  return (
    <details className="note-list">
      <summary>Structured note list ({props.notes.length})</summary>
      <ol>
        {props.notes.map((note) => (
          <li
            className="mono"
            key={`${formatBeat(note.at)}:${note.panel_mask}:${formatBeat(note.hold)}`}
          >
            Beat {formatBeat(note.at)}, mask {note.panel_mask}, hold {formatBeat(note.hold)}
          </li>
        ))}
      </ol>
    </details>
  )
}
