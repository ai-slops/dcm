import { useMemo, useState } from "react"
import type { Beat } from "../../shared/beat.ts"
import type { BeatReusableComponent, GenerationProjectV2 } from "../../shared/beat-projects.ts"
import { BeatHybridRulesSchema } from "../../shared/beat-rules.ts"
import type { LibrarySong } from "../../shared/library.ts"
import type { ProjectGenerationResult } from "../../shared/project-commands.ts"
import type { ComponentId } from "../../shared/project-identities.ts"
import { libraryApi } from "../api/library-client.ts"
import { placeBeatHold, toggleBeatPanel } from "../domain/beat-editor.ts"
import { validateRowsPerMeasureChange } from "../domain/beat-timeline.ts"
import {
  beatPlaybackProjectFor,
  projectAutomaticExtent,
  replaceBeatHybridRules,
  timingWithProjectInformation,
} from "../domain/project-grid.ts"
import { AutomaticRegionsEditor } from "./AutomaticRegionsEditor.tsx"
import { browserAudioPlaybackEnvironmentFor } from "./audioPlaybackEnvironment.ts"
import { ProjectFragmentLibrary } from "./ProjectFragmentLibrary.tsx"
import { ProjectGeneratePanel } from "./ProjectGeneratePanel.tsx"
import { ProjectInformationEditor } from "./ProjectInformationEditor.tsx"
import { ProjectRuleConversion } from "./ProjectRuleConversion.tsx"
import { Badge, Button } from "./primitives.tsx"
import { Timeline } from "./Timeline.tsx"
import { Transport } from "./Transport.tsx"
import { useAudioPlaybackSource } from "./useAudioPlayback.ts"

export function ProjectGridEditor(props: {
  readonly busy: boolean
  readonly components: readonly BeatReusableComponent[]
  readonly dirty: boolean
  readonly generation: ProjectGenerationResult | null
  readonly project: GenerationProjectV2
  readonly song: LibrarySong
  readonly onApplyFragment: (componentId: ComponentId, anchor: Beat) => void
  readonly onGenerate: (name: string, seed: string) => void
  readonly onProject: (project: GenerationProjectV2) => void
  readonly onPublishFragment: (name: string, start: Beat, end: Beat) => void
  readonly onSave: () => void
}) {
  const [error, setError] = useState("")
  const playbackProject = useMemo(
    () => beatPlaybackProjectFor(props.project, props.song),
    [props.project, props.song],
  )
  const environment = useMemo(
    () => browserAudioPlaybackEnvironmentFor(() => libraryApi.songAudio(props.song.id)),
    [props.song.id],
  )
  const playback = useAudioPlaybackSource(playbackProject, {
    key: `${props.project.id}:${props.song.audio.sha256}`,
    environment,
    hasAudio: props.song.audio.byte_length > 0,
  })
  const hybrid = props.project.generation_rules.schema_version === 2
  const rules = hybrid ? BeatHybridRulesSchema.parse(props.project.generation_rules) : null
  const notes = rules?.fixed_notes ?? []

  function updateRules(nextRules: typeof rules): void {
    if (nextRules === null) return
    try {
      props.onProject(replaceBeatHybridRules(props.project, nextRules))
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project rules are invalid")
    }
  }

  function updateNotes(nextNotes: typeof notes): void {
    if (rules !== null) updateRules({ ...rules, fixed_notes: nextNotes })
  }

  function edit(action: () => void): void {
    if (props.busy || rules === null) return
    try {
      action()
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The fixed note edit is invalid")
    }
  }

  return (
    <section className="project-grid-editor">
      <section className="project-grid-toolbar" aria-label="Project save status">
        <div className="project-grid-toolbar__identity">
          <strong>{props.project.name}</strong>
          <span>
            {props.song.title} · {props.song.artist}
          </span>
        </div>
        <Badge tone={props.dirty ? "warning" : "success"}>
          {props.dirty ? "Unsaved project draft" : `Saved revision ${props.project.revision}`}
        </Badge>
        <Button variant="primary" disabled={props.busy || !props.dirty} onClick={props.onSave}>
          {props.busy ? "Saving project" : "Save project"}
        </Button>
      </section>
      {rules === null ? (
        <ProjectRuleConversion project={props.project} onProject={props.onProject} />
      ) : (
        <div className="project-grid-workspace">
          <div className="project-grid-canvas project-grid-timeline">
            {props.project.mode === "Double" ? (
              <p className="project-grid-scroll-cue" role="note">
                Scroll sideways inside the grid to reach all 10 lanes.
              </p>
            ) : null}
            <Timeline
              notes={notes}
              timing={props.project.timing}
              mode={props.project.mode}
              playback={playback}
              onToggleTap={(at, lane) =>
                edit(() => updateNotes(toggleBeatPanel(notes, props.project.timing, at, lane)))
              }
              onPlaceHold={(head, tail, lane) =>
                edit(() =>
                  updateNotes(placeBeatHold(notes, props.project.timing, head, tail, lane)),
                )
              }
              onRowsPerMeasureChange={(at, rowsPerMeasure) =>
                edit(() => {
                  const result = validateRowsPerMeasureChange(
                    props.project.timing,
                    notes,
                    at,
                    rowsPerMeasure,
                  )
                  if (result.kind === "error") throw new ProjectGridInputError(result.message)
                  props.onProject(
                    timingWithProjectInformation(props.project, {
                      chartArtist: props.project.chart_artist,
                      timing: result.timing,
                    }),
                  )
                })
              }
              automaticRegions={rules.regions.map((region) => ({
                id: region.id,
                name: region.name,
                start: region.rules.start,
                end: region.rules.end,
              }))}
              regionsReadOnly
            />
          </div>
          <aside
            className="project-grid-inspector"
            aria-label="Project information, automatic regions, and fragment controls"
          >
            <ProjectInformationEditor
              automaticExtent={projectAutomaticExtent(props.project)}
              chartArtist={props.project.chart_artist}
              disabled={props.busy}
              notes={notes}
              songArtist={props.song.artist}
              timing={props.project.timing}
              onChange={(change) =>
                edit(() => props.onProject(timingWithProjectInformation(props.project, change)))
              }
            />
            <AutomaticRegionsEditor disabled={props.busy} rules={rules} onChange={updateRules} />
            <ProjectFragmentLibrary
              busy={props.busy || props.dirty}
              components={props.components}
              onPublish={(input) => props.onPublishFragment(input.name, input.start, input.end)}
              onApply={props.onApplyFragment}
            />
            <ProjectGeneratePanel
              busy={props.busy}
              dirty={props.dirty}
              generation={props.generation}
              onGenerate={props.onGenerate}
            />
          </aside>
        </div>
      )}
      {error === "" ? null : (
        <p className="operation-result operation-result--error" role="alert">
          {error}
        </p>
      )}
      <Transport project={playbackProject} playback={playback} />
    </section>
  )
}

class ProjectGridInputError extends Error {
  override readonly name = "ProjectGridInputError"
}
