import { useCallback, useMemo, useRef, useState } from "react"

import type {
  Bootstrap,
  ChartProposal,
  CurrentDocument,
  StudioProjectV1,
} from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { quantizedPlacementTick } from "../domain/edit-snap.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { editPanelAtTick, findPanelDemand, updatePanelDemand } from "../domain/editor.ts"
import { AgentPanel } from "./AgentPanel.tsx"
import { CenterStudio } from "./CenterStudio.tsx"
import { DocumentToolbar } from "./DocumentToolbar.tsx"
import { Inspector } from "./Inspector.tsx"
import { type MobileTab, MobileTabs } from "./MobileTabs.tsx"
import { editorStateForReplacement, reconcileAppliedDocument } from "./studio-state.ts"
import type { EditorTool } from "./studio-types.ts"
import { Transport } from "./Transport.tsx"
import { useAudioPlayback } from "./useAudioPlayback.ts"
import { useBeforeUnload } from "./useBeforeUnload.ts"

export function Studio({ bootstrap }: { readonly bootstrap: Bootstrap }) {
  const [project, setProjectState] = useState<StudioProjectV1>(bootstrap.document.project)
  const projectRef = useRef(project)
  function setProject(nextProject: StudioProjectV1) {
    projectRef.current = nextProject
    setProjectState(nextProject)
  }
  const [persistedProject, setPersistedProject] = useState(bootstrap.document.project)
  const [revision, setRevision] = useState(bootstrap.document.revision)
  const [tool, setTool] = useState<EditorTool>("tap")
  const [tick, setTick] = useState(0)
  const [lane, setLane] = useState<PanelIndex>(0)
  const [holdTicks, setHoldTicks] = useState(project.chart.ticks_per_beat)
  const [quantize, setQuantize] = useState(1)
  const [tab, setTab] = useState<MobileTab>("editor")
  const [proposals, setProposals] = useState<readonly ChartProposal[]>(bootstrap.proposals ?? [])
  const [status, setStatus] = useState("Ready")
  const [validationError, setValidationError] = useState("")
  const [past, setPast] = useState<readonly StudioProjectV1[]>([])
  const [future, setFuture] = useState<readonly StudioProjectV1[]>([])
  const playback = useAudioPlayback(project)
  const dirty = useMemo(
    () => JSON.stringify(project) !== JSON.stringify(persistedProject),
    [persistedProject, project],
  )
  useBeforeUnload(dirty)
  const selectedDemand = findPanelDemand(project.chart, tick, lane)

  function replaceProject(nextProject: StudioProjectV1) {
    setPast((current) => [...current, project])
    setFuture([])
    setProject(nextProject)
    setValidationError("")
  }

  function undo() {
    const previous = past.at(-1)
    if (previous === undefined) return
    setFuture((current) => [project, ...current])
    setPast((current) => current.slice(0, -1))
    setProject(previous)
  }

  function redo() {
    const next = future[0]
    if (next === undefined) return
    setPast((current) => [...current, project])
    setFuture((current) => current.slice(1))
    setProject(next)
  }

  function acceptDocument(document: CurrentDocument) {
    const editorState = editorStateForReplacement(document.project)
    playback.stop()
    setProject(document.project)
    setPersistedProject(document.project)
    setRevision(document.revision)
    setTick(editorState.tick)
    setLane(editorState.lane)
    setHoldTicks(editorState.holdTicks)
    setQuantize(editorState.quantize)
    setValidationError("")
    setPast([])
    setFuture([])
  }

  const addProposal = useCallback((proposal: ChartProposal) => {
    setProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)])
  }, [])

  function editCell(nextTick: number, nextLane: PanelIndex) {
    try {
      const existing = findPanelDemand(project.chart, nextTick, nextLane)
      const placementTick =
        tool !== "select" && tool !== "erase" && existing === undefined
          ? quantizedPlacementTick(project.chart, { tick: nextTick, panel: nextLane }, quantize)
          : nextTick
      setTick(placementTick)
      setLane(nextLane)
      if (tool === "select") return
      const action =
        tool === "erase" ||
        (tool === "tap" && existing?.tick === nextTick && existing.hold_ticks === 0)
          ? "erase"
          : "place"
      const chart = editPanelAtTick(project.chart, {
        tick: placementTick,
        panel: nextLane,
        holdTicks: tool === "hold" ? holdTicks : 0,
        action,
      })
      replaceProject({ ...project, chart })
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The note edit is invalid")
    }
  }

  function selectCell(nextTick: number, nextLane: PanelIndex) {
    setTick(nextTick)
    setLane(nextLane)
  }

  function updateSelection(nextTick: number, nextLane: PanelIndex, nextHoldTicks: number) {
    try {
      const chart = updatePanelDemand(project.chart, {
        sourceTick: tick,
        sourcePanel: lane,
        tick: nextTick,
        panel: nextLane,
        holdTicks: nextHoldTicks,
      })
      replaceProject({ ...project, chart })
      setTick(nextTick)
      setLane(nextLane)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The selected note is invalid")
    }
  }

  async function save() {
    setStatus("Saving")
    const savingProject = project
    try {
      const document = await studioApi.save(bootstrap.csrf_token, {
        base_revision: revision,
        project: savingProject,
      })
      setRevision(document.revision)
      setPersistedProject(document.project)
      if (projectRef.current === savingProject) setProject(document.project)
      setValidationError("")
      setStatus(projectRef.current === savingProject ? "Saved" : "Saved older draft")
    } catch (error) {
      setStatus("Save failed")
      setValidationError(error instanceof Error ? error.message : "Save failed. Try again.")
    }
  }

  async function apply(proposal: ChartProposal) {
    const startedFromProject = projectRef.current
    const document = await studioApi.applyProposal(bootstrap.csrf_token, proposal.id, {
      base_revision: revision,
    })
    const reconciled = reconcileAppliedDocument({
      startedFromProject,
      currentProject: projectRef.current,
      document,
    })
    const historyProject = reconciled.historyProject
    if (historyProject !== null) {
      setPast((current) => [...current, historyProject])
      setFuture([])
    }
    setProject(reconciled.project)
    setPersistedProject(reconciled.persistedProject)
    setRevision(reconciled.revision)
    setProposals((current) => current.filter((item) => item.id !== proposal.id))
  }

  async function discard(proposal: ChartProposal) {
    await studioApi.discardProposal(bootstrap.csrf_token, proposal.id)
    setProposals((current) => current.filter((item) => item.id !== proposal.id))
  }

  return (
    <main className="studio-shell">
      <DocumentToolbar
        bootstrap={bootstrap}
        project={project}
        revision={revision}
        dirty={dirty}
        status={status}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        setProject={setProject}
        undo={undo}
        redo={redo}
        save={save}
        onDocument={acceptDocument}
        onProposal={addProposal}
        onStatus={setStatus}
      />
      <MobileTabs selected={tab} onSelect={setTab} />
      <div className="studio-body">
        <aside className={`inspector mobile-${tab}`} id="tools-panel">
          <Inspector
            project={project}
            tool={tool}
            tick={tick}
            lane={lane}
            holdTicks={holdTicks}
            selectedDemand={selectedDemand}
            validationError={validationError}
            setTool={setTool}
            setHoldTicks={setHoldTicks}
            updateSelection={updateSelection}
            replaceProject={replaceProject}
          />
        </aside>
        <CenterStudio
          tab={tab}
          chart={project.chart}
          music={project.music}
          ucsMode={project.ucs_mode ?? "Double"}
          playback={playback}
          selectedTick={tick}
          selectedLane={lane}
          quantize={quantize}
          onQuantize={setQuantize}
          onCell={editCell}
          onSelect={selectCell}
        />
        <aside
          className={`agent-rail mobile-${tab}`}
          id="agent-panel"
          role="tabpanel"
          aria-labelledby="agent-tab"
        >
          <AgentPanel
            bootstrap={bootstrap}
            dirty={dirty}
            revision={revision}
            proposals={proposals}
            onProposal={addProposal}
            apply={apply}
            discard={discard}
          />
        </aside>
      </div>
      <Transport
        project={project}
        selectedTick={tick}
        onSeekSelection={setTick}
        playback={playback}
      />
    </main>
  )
}
