import { useEffect, useRef, useState } from "react"

import type { GenerationProject } from "../../shared/generation-projects.ts"
import type { LibrarySong, SongId } from "../../shared/library.ts"
import type { StudioProjectV1, UcsMode } from "../../shared/project.ts"
import { Button } from "./primitives.tsx"
import { initialProjectJson, ProjectFormError, parseProjectForm } from "./project-form.ts"

type ProjectEditorFormProps = {
  readonly busy: boolean
  readonly currentChart: StudioProjectV1
  readonly project: GenerationProject | null
  readonly songs: readonly LibrarySong[]
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onLoadSongProject: (songId: SongId) => Promise<StudioProjectV1 | null>
  readonly onCreate: (
    input: ReturnType<typeof parseProjectForm> & { readonly songId: SongId },
  ) => void
  readonly onWrite: (input: ReturnType<typeof parseProjectForm>) => void
}

type FormFingerprintInput = {
  readonly name: string
  readonly songId: SongId | ""
  readonly mode: UcsMode | ""
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
}

export function ProjectEditorForm(props: ProjectEditorFormProps) {
  const json = initialProjectJson(props.project ?? props.currentChart)
  const [name, setName] = useState(props.project?.name ?? "")
  const [songId, setSongId] = useState<SongId | "">(props.project?.song_id ?? "")
  const [mode, setMode] = useState<UcsMode | "">(props.project?.mode ?? "")
  const [timing, setTiming] = useState(json.timing)
  const [evaluation, setEvaluation] = useState(json.evaluation)
  const [rules, setRules] = useState(json.rules)
  const [baseline, setBaseline] = useState(() =>
    formFingerprint({
      name: props.project?.name ?? "",
      songId: props.project?.song_id ?? "",
      mode: props.project?.mode ?? "",
      ...json,
    }),
  )
  const [error, setError] = useState("")
  const [songLoading, setSongLoading] = useState(false)
  const [songTimingReady, setSongTimingReady] = useState(props.project !== null)
  const songLoadGeneration = useRef(0)

  useEffect(() => {
    songLoadGeneration.current += 1
    const next = initialProjectJson(props.project ?? props.currentChart)
    setName(props.project?.name ?? "")
    setSongId(props.project?.song_id ?? "")
    setMode(props.project?.mode ?? "")
    setTiming(next.timing)
    setEvaluation(next.evaluation)
    setRules(next.rules)
    setBaseline(
      formFingerprint({
        name: props.project?.name ?? "",
        songId: props.project?.song_id ?? "",
        mode: props.project?.mode ?? "",
        ...next,
      }),
    )
    setError("")
    setSongLoading(false)
    setSongTimingReady(props.project !== null)
  }, [props.currentChart, props.project])

  useEffect(() => {
    props.onDirtyChange(
      formFingerprint({ name, songId, mode, timing, evaluation, rules }) !== baseline,
    )
  }, [baseline, evaluation, mode, name, props.onDirtyChange, rules, songId, timing])

  return (
    <form
      className="project-editor"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          const value = parseProjectForm({ name, mode, timing, evaluation, rules })
          if (props.project === null) {
            if (songId === "") throw new ProjectFormError("Choose a song")
            if (!songTimingReady)
              throw new ProjectFormError("Load timing from the selected song before creating")
            props.onCreate({ ...value, songId })
          } else props.onWrite(value)
        } catch (caught) {
          if (caught instanceof ProjectFormError) setError(caught.message)
          else throw caught
        }
      }}
    >
      <fieldset className="project-editor__fields" disabled={props.busy || songLoading}>
        <div className="project-editor__identity">
          <label>
            Project name
            <input required value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            Song
            <select
              required
              disabled={props.project !== null}
              value={songId}
              onChange={(event) => {
                const song = props.songs.find((item) => item.id === event.currentTarget.value)
                if (song === undefined) return
                setSongId(song.id)
                const request = ++songLoadGeneration.current
                setSongLoading(true)
                setSongTimingReady(false)
                setError("")
                void props
                  .onLoadSongProject(song.id)
                  .then(
                    (songProject) => {
                      if (request !== songLoadGeneration.current) return
                      if (songProject === null) {
                        setError("The selected song has no saved chart timing to use.")
                        return
                      }
                      const next = initialProjectJson(songProject)
                      setTiming(next.timing)
                      setRules(next.rules)
                      setSongTimingReady(true)
                    },
                    (caught: unknown) => {
                      if (request !== songLoadGeneration.current) return
                      setError(
                        caught instanceof Error ? caught.message : "Song timing loading failed",
                      )
                    },
                  )
                  .finally(() => {
                    if (request === songLoadGeneration.current) setSongLoading(false)
                  })
              }}
            >
              <option value="">Choose song</option>
              {props.songs.map((song) => (
                <option value={song.id} key={song.id}>
                  {song.title} · {song.artist}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select
              required
              disabled={props.project !== null}
              value={mode}
              onChange={(event) => {
                if (event.currentTarget.value === "Single") setMode("Single")
                if (event.currentTarget.value === "Double") setMode("Double")
              }}
            >
              <option value="">Choose mode</option>
              <option value="Single">Single · 5 lanes</option>
              <option value="Double">Double · 10 lanes</option>
            </select>
          </label>
        </div>
        {props.project === null ? (
          <p className="status-copy">
            Choose a song to load timing and the initial generator range from its first saved chart.
          </p>
        ) : null}
        <JsonField label="Timing" value={timing} onChange={setTiming} />
        <JsonField label="Evaluation contract" value={evaluation} onChange={setEvaluation} />
        <JsonField label="Generation rules" value={rules} onChange={setRules} />
        {error === "" ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy || songLoading || (props.project === null && !songTimingReady)}
        >
          {songLoading
            ? "Loading song timing"
            : props.project === null
              ? "Create project"
              : "Save project"}
        </Button>
      </fieldset>
    </form>
  )
}

function formFingerprint(input: FormFingerprintInput): string {
  return JSON.stringify([
    input.name,
    input.songId,
    input.mode,
    input.timing,
    input.evaluation,
    input.rules,
  ])
}

function JsonField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="project-json-field">
      <span>{props.label}</span>
      <textarea
        className="mono"
        rows={8}
        spellCheck={false}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  )
}
