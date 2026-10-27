import { useState } from "react"
import type { Revision, UcsMode } from "../../shared/index.ts"
import type { LibraryRevision } from "../../shared/library.ts"
import type { NewSong } from "../../shared/library-commands.ts"
import { Button } from "./primitives.tsx"

type NewSongDraft = {
  readonly title: string
  readonly artist: string
  readonly chartName: string
  readonly bpm: number
  readonly beats: number
  readonly mode: UcsMode
  readonly audio?: File
}

type NewSongFormProps = {
  readonly busy: boolean
  readonly libraryRevision: LibraryRevision
  readonly documentRevision: Revision
  readonly onCreate: (input: NewSong, audio?: File) => void
}

export function LibraryNewSongForm(props: NewSongFormProps) {
  const [draft, setDraft] = useState<NewSongDraft>({
    title: "",
    artist: "",
    chartName: "New chart",
    bpm: 120,
    beats: 128,
    mode: "Double",
  })

  return (
    <section className="library-section" aria-labelledby="new-song-heading">
      <div className="library-section__heading">
        <h3 id="new-song-heading">Create song</h3>
        <p className="status-copy">Start with a blank chart. Audio is optional.</p>
      </div>
      <form
        className="library-form"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCreate(
            {
              library_revision: props.libraryRevision,
              base_revision: props.documentRevision,
              title: draft.title,
              artist: draft.artist,
              chart_name: draft.chartName,
              bpm: draft.bpm,
              beats: draft.beats,
              mode: draft.mode,
            },
            draft.audio,
          )
        }}
      >
        <div className="library-form__grid">
          <label>
            Song title
            <input
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            Artist
            <input
              required
              value={draft.artist}
              onChange={(event) => setDraft({ ...draft, artist: event.target.value })}
            />
          </label>
          <label>
            First chart name
            <input
              required
              value={draft.chartName}
              onChange={(event) => setDraft({ ...draft, chartName: event.target.value })}
            />
          </label>
          <label>
            Mode
            <select
              value={draft.mode}
              onChange={(event) =>
                setDraft({ ...draft, mode: event.target.value === "Single" ? "Single" : "Double" })
              }
            >
              <option>Double</option>
              <option>Single</option>
            </select>
          </label>
          <label>
            BPM
            <input
              required
              type="number"
              min="1"
              max="1000"
              step="0.01"
              value={draft.bpm}
              onChange={(event) => setDraft({ ...draft, bpm: event.target.valueAsNumber })}
            />
          </label>
          <label>
            Beats
            <input
              required
              type="number"
              min="1"
              max="20000"
              value={draft.beats}
              onChange={(event) => setDraft({ ...draft, beats: event.target.valueAsNumber })}
            />
          </label>
        </div>
        <label className="file-action">
          Optional audio
          <input
            type="file"
            accept=".wav,.ogg,.mp3,audio/wav,audio/ogg,audio/mpeg"
            onChange={(event) => {
              const audio = event.target.files?.item(0)
              setDraft(audio === null || audio === undefined ? draft : { ...draft, audio })
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={props.busy}>
          {props.busy ? "Creating song" : "Create song"}
        </Button>
      </form>
    </section>
  )
}
