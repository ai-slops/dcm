import { useEffect, useState } from "react"
import type { BaseUcsRef } from "../../shared/beat.ts"
import type { BeatChartDocument, GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { LibrarySnapshot, SongId } from "../../shared/library.ts"
import type { UcsMode } from "../../shared/project.ts"
import { type BaseTimingSourceOption, ProjectBaseTimingPicker } from "./ProjectBaseTimingPicker.tsx"
import { Button, Field } from "./primitives.tsx"
import { initialBeatProjectJson, ProjectFormError, parseBeatProjectForm } from "./project-form.ts"
import {
  emptyBeatProjectFormJson,
  ProjectJsonField,
  projectFormFingerprint,
} from "./project-form-support.tsx"
import { useProjectBaseTiming } from "./useProjectBaseTiming.ts"

type BeatProjectFormInput = ReturnType<typeof parseBeatProjectForm>

export function ProjectEditorForm(props: {
  readonly busy: boolean
  readonly library: LibrarySnapshot
  readonly project: GenerationProjectV2 | null
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onLoadBase: (songId: SongId, source: BaseUcsRef) => Promise<BeatChartDocument>
  readonly onLoadBaseSources: (songId: SongId) => Promise<readonly BaseTimingSourceOption[]>
  readonly onCreate: (
    input: BeatProjectFormInput & { readonly songId: SongId; readonly baseUcsRef: BaseUcsRef },
  ) => void
  readonly onWrite: (input: BeatProjectFormInput) => void
}) {
  const initial =
    props.project === null ? emptyBeatProjectFormJson() : initialBeatProjectJson(props.project)
  const [name, setName] = useState(props.project?.name ?? "")
  const [songId, setSongId] = useState<SongId | "">(props.project?.song_id ?? "")
  const [mode, setMode] = useState<UcsMode | "">(props.project?.mode ?? "")
  const [chartArtist, setChartArtist] = useState(props.project?.chart_artist ?? "")
  const base = useProjectBaseTiming({
    initial: { ...initial, baseSource: props.project?.base_ucs_ref ?? null },
    onLoadBase: props.onLoadBase,
    onLoadBaseSources: props.onLoadBaseSources,
  })
  const [baseline, setBaseline] = useState(() =>
    projectFormFingerprint({
      name,
      songId,
      mode,
      chartArtist,
      baseSource: props.project?.base_ucs_ref ?? null,
      ...initial,
    }),
  )

  useEffect(() => {
    const next =
      props.project === null ? emptyBeatProjectFormJson() : initialBeatProjectJson(props.project)
    const identity = {
      name: props.project?.name ?? "",
      songId: props.project?.song_id ?? "",
      mode: props.project?.mode ?? "",
      chartArtist: props.project?.chart_artist ?? "",
      baseSource: props.project?.base_ucs_ref ?? null,
    } as const
    setName(identity.name)
    setSongId(identity.songId)
    setMode(identity.mode)
    setChartArtist(identity.chartArtist)
    base.reset({ ...next, baseSource: identity.baseSource })
    setBaseline(projectFormFingerprint({ ...identity, ...next }))
  }, [base.reset, props.project])

  useEffect(() => {
    props.onDirtyChange(
      projectFormFingerprint({
        name,
        songId,
        mode,
        chartArtist,
        baseSource: base.baseSource,
        timing: base.timing,
        evaluation: base.evaluation,
        rules: base.rules,
      }) !== baseline,
    )
  }, [
    baseline,
    base.baseSource,
    chartArtist,
    base.evaluation,
    mode,
    name,
    props.onDirtyChange,
    base.rules,
    songId,
    base.timing,
  ])

  return (
    <form
      className="project-editor"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          const value = parseBeatProjectForm({
            name,
            mode,
            chartArtist,
            timing: base.timing,
            evaluation: base.evaluation,
            rules: base.rules,
          })
          if (props.project === null) {
            if (songId === "") throw new ProjectFormError("Choose a song")
            if (base.baseSource === null) throw new ProjectFormError("Choose exact base timing")
            if (value.chartArtist === null) throw new ProjectFormError("Enter a chart artist")
            props.onCreate({ ...value, songId, baseUcsRef: base.baseSource })
          } else props.onWrite(value)
        } catch (caught) {
          if (caught instanceof ProjectFormError) base.setError(caught.message)
          else throw caught
        }
      }}
    >
      <fieldset className="project-editor__fields" disabled={props.busy || base.loading}>
        <div className="project-editor__identity">
          <Field label="Project name">
            <input required value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </Field>
          <Field label="Song">
            <select
              required
              disabled={props.project !== null}
              value={songId}
              onChange={(event) => {
                const song = props.library.songs.find(
                  (candidate) => candidate.id === event.currentTarget.value,
                )
                if (song === undefined) return
                setSongId(song.id)
                base.loadSources(song.id)
              }}
            >
              <option value="">Choose song</option>
              {props.library.songs.map((song) => (
                <option value={song.id} key={song.id}>
                  {song.title} · {song.artist}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode">
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
          </Field>
          <Field label="Chart artist">
            <input
              required={props.project === null}
              value={chartArtist}
              onChange={(event) => setChartArtist(event.currentTarget.value)}
            />
          </Field>
          {props.project === null ? (
            <ProjectBaseTimingPicker
              disabled={songId === "" || base.loading}
              options={base.options}
              selected={base.baseSource}
              onSelect={(option) => {
                if (songId !== "") base.loadBase(songId, option)
              }}
            />
          ) : null}
        </div>
        {props.project === null ? (
          <p className="status-copy">
            Choose exact archive UCS or stored-chart timing. Duration starts automatic, and no chart
            is selected implicitly.
          </p>
        ) : null}
        <ProjectJsonField label="Timing" value={base.timing} onChange={base.setTiming} />
        <ProjectJsonField
          label="Evaluation contract"
          value={base.evaluation}
          onChange={base.setEvaluation}
        />
        <ProjectJsonField label="Generation rules" value={base.rules} onChange={base.setRules} />
        {base.error === "" ? null : (
          <p className="field-error" role="alert">
            {base.error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={
            props.busy ||
            base.loading ||
            (props.project === null &&
              (base.baseSource === null || base.timing === "" || base.evaluation === ""))
          }
        >
          {base.loading
            ? "Loading base timing"
            : props.project === null
              ? "Create project"
              : "Save project"}
        </Button>
      </fieldset>
    </form>
  )
}
