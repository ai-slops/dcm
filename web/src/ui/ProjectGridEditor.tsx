import { useMemo, useState } from "react"

import type { GenerationProject, MusicTiming } from "../../shared/generation-projects.ts"
import { automaticRegionViews, type HybridRules } from "../../shared/generation-rules.ts"
import type { LibrarySong } from "../../shared/library.ts"
import type { ProjectGenerationResult } from "../../shared/project-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import type { PanelIndex } from "../domain/editor.ts"
import {
  editPanelAtTick,
  findPanelDemand,
  placePanelHold,
  togglePanelAtTick,
} from "../domain/editor.ts"
import {
  fixedChartForProject,
  playbackProjectFor,
  replaceHybridRules,
  tickIsAutomatic,
} from "../domain/project-grid.ts"
import { AutomaticRegionsEditor } from "./AutomaticRegionsEditor.tsx"
import { browserAudioPlaybackEnvironmentFor } from "./audioPlaybackEnvironment.ts"
import { ProjectGeneratePanel } from "./ProjectGeneratePanel.tsx"
import { ProjectRuleConversion } from "./ProjectRuleConversion.tsx"
import { ProjectTailEditor } from "./ProjectTailEditor.tsx"
import { Badge, Button, Field, ToolChip } from "./primitives.tsx"
import { Timeline } from "./Timeline.tsx"
import { Transport } from "./Transport.tsx"
import { useAudioPlaybackSource } from "./useAudioPlayback.ts"

type GridTool = "tap" | "hold" | "select" | "erase"

export function ProjectGridEditor(props: {
  readonly busy: boolean
  readonly dirty: boolean
  readonly generation: ProjectGenerationResult | null
  readonly project: GenerationProject
  readonly song: LibrarySong
  readonly timingTemplate: MusicTiming
  readonly onGenerate: (name: string, seed: string) => void
  readonly onProject: (project: GenerationProject) => void
  readonly onSave: () => void
}) {
  const [tool, setTool] = useState<GridTool>("tap")
  const [selectedTick, setSelectedTick] = useState(0)
  const [selectedLane, setSelectedLane] = useState<PanelIndex>(0)
  const [quantize, setQuantize] = useState(1)
  const [holdTicks, setHoldTicks] = useState(String(props.project.timing.ticks_per_beat))
  const [error, setError] = useState("")
  const playbackProject = useMemo(
    () => playbackProjectFor(props.project, props.song),
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
  const chart = fixedChartForProject(props.project)
  const hybrid = props.project.generation_rules.schema_version === 2

  function updateRules(rules: HybridRules): void {
    try {
      props.onProject(replaceHybridRules(props.project, rules))
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project rules are invalid")
    }
  }

  function editCell(tick: number, lane: PanelIndex): void {
    setSelectedTick(tick)
    setSelectedLane(lane)
    if (props.busy || !hybrid || tool === "select") return
    if (tickIsAutomatic(props.project.generation_rules, tick)) {
      setError("Fixed notes cannot be edited inside an automatic region.")
      return
    }
    const duration = Number(holdTicks)
    if (tool === "hold" && (!Number.isSafeInteger(duration) || duration <= 0)) {
      setError("Hold duration must be a positive whole-number tick count.")
      return
    }
    try {
      const existing = findPanelDemand(chart, tick, lane)
      const nextChart =
        tool === "erase" || existing !== undefined
          ? editPanelAtTick(chart, { tick, panel: lane, holdTicks: 0, action: "erase" })
          : tool === "hold"
            ? editPanelAtTick(chart, { tick, panel: lane, holdTicks: duration, action: "place" })
            : togglePanelAtTick(chart, { tick, panel: lane }, quantize)
      updateRules({ ...props.project.generation_rules, fixed_notes: nextChart.notes })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The fixed note edit is invalid")
    }
  }

  function editHold(startTick: number, endTick: number, lane: PanelIndex): void {
    if (props.busy || !hybrid || tool === "select" || tool === "erase") return
    const first = Math.min(startTick, endTick)
    const last = Math.max(startTick, endTick)
    const overlapsRegion = props.project.generation_rules.regions.some(
      (region) => first < region.rules.end_tick && last >= region.rules.start_tick,
    )
    if (overlapsRegion) {
      setError("A fixed hold and its tail cannot enter an automatic region.")
      return
    }
    try {
      const nextChart = placePanelHold(chart, { startTick, endTick, panel: lane }, quantize)
      updateRules({ ...props.project.generation_rules, fixed_notes: nextChart.notes })
      setSelectedTick(first)
      setSelectedLane(lane)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The fixed hold is invalid")
    }
  }

  return (
    <section className="project-grid-editor">
      <section className="project-grid-toolbar" aria-label="Project grid tools">
        <div className="project-grid-toolbar__identity">
          <strong>{props.project.name}</strong>
          <span>
            {props.song.title} · {props.song.artist}
          </span>
        </div>
        <Badge tone={props.dirty ? "warning" : "success"}>
          {props.dirty ? "Unsaved project draft" : `Saved revision ${props.project.revision}`}
        </Badge>
        <div className="cluster">
          {(["tap", "hold", "select", "erase"] as const).map((candidate) => (
            <ToolChip
              type="button"
              key={candidate}
              pressed={tool === candidate}
              disabled={!hybrid || props.busy}
              onClick={() => setTool(candidate)}
            >
              {candidate[0]?.toUpperCase()}
              {candidate.slice(1)}
            </ToolChip>
          ))}
        </div>
        <Field label="Hold duration ticks">
          <input
            className="mono project-grid-toolbar__hold"
            disabled={!hybrid || props.busy || tool !== "hold"}
            inputMode="numeric"
            value={holdTicks}
            onChange={(event) => setHoldTicks(event.currentTarget.value)}
          />
        </Field>
        <Button variant="primary" disabled={props.busy || !props.dirty} onClick={props.onSave}>
          {props.busy ? "Saving project" : "Save project"}
        </Button>
      </section>
      {hybrid ? (
        <div className="project-grid-workspace">
          <div className="project-grid-canvas project-grid-timeline">
            {props.project.mode === "Double" ? (
              <p className="project-grid-scroll-cue" role="note">
                Scroll sideways inside the grid to reach all 10 lanes.
              </p>
            ) : null}
            <Timeline
              chart={chart}
              music={playbackProject.music}
              ucsMode={props.project.mode}
              playback={playback}
              selectedTick={selectedTick}
              selectedLane={selectedLane}
              quantize={quantize}
              onQuantize={setQuantize}
              onCell={editCell}
              onHold={editHold}
              onSelect={(tick, lane) => {
                setSelectedTick(tick)
                setSelectedLane(lane)
              }}
              automaticRegions={automaticRegionViews(props.project.generation_rules)}
              regionsReadOnly
            />
          </div>
          <aside
            className="project-grid-inspector"
            aria-label="Automatic region and timing controls"
          >
            <AutomaticRegionsEditor
              disabled={props.busy}
              rules={props.project.generation_rules}
              onChange={updateRules}
            />
            <ProjectTailEditor
              disabled={props.busy}
              project={props.project}
              template={props.timingTemplate}
              onChange={props.onProject}
            />
            <ProjectGeneratePanel
              busy={props.busy}
              dirty={props.dirty}
              generation={props.generation}
              onGenerate={props.onGenerate}
            />
          </aside>
        </div>
      ) : (
        <ProjectRuleConversion project={props.project} onProject={props.onProject} />
      )}
      {error === "" ? null : (
        <p className="operation-result operation-result--error" role="alert">
          {error}
        </p>
      )}
      <Transport
        project={playbackProject}
        selectedTick={selectedTick}
        onSeekSelection={setSelectedTick}
        playback={playback}
      />
    </section>
  )
}
