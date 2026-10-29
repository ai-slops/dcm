import { useMemo, useRef, useState } from "react"

import type {
  Beat,
  BeatChartDocument,
  Bootstrap,
  ChartProposal,
  CurrentDocument,
} from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { placeBeatHold, toggleBeatPanel } from "../domain/beat-editor.ts"
import { validateRowsPerMeasureChange } from "../domain/beat-timeline.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { CenterStudio } from "./CenterStudio.tsx"
import { DocumentToolbar } from "./DocumentToolbar.tsx"
import { Inspector } from "./Inspector.tsx"
import { type MobileTab, MobileTabs } from "./MobileTabs.tsx"
import { StudioAgentAside } from "./StudioAgentAside.tsx"
import { reconcileAppliedDocument } from "./studio-state.ts"
import { Transport } from "./Transport.tsx"
import { useAudioPlayback } from "./useAudioPlayback.ts"
import { useBeforeUnload } from "./useBeforeUnload.ts"
import { useDocumentSave } from "./useDocumentSave.ts"
import { useProposalOwner } from "./useProposalOwner.ts"
import { useRefreshedBootstrap } from "./useRefreshedBootstrap.ts"

export function Studio({ bootstrap }: { readonly bootstrap: Bootstrap }) {
  const [project, setProjectState] = useState<BeatChartDocument>(bootstrap.document.project)
  const projectRef = useRef(project)
  function setProject(nextProject: BeatChartDocument): void {
    projectRef.current = nextProject
    setProjectState(nextProject)
  }
  const [persistedProject, setPersistedProject] = useState(bootstrap.document.project)
  const [revision, setRevision] = useState(bootstrap.document.revision)
  const [origin, setOrigin] = useState(bootstrap.document.origin)
  const [tab, setTab] = useState<MobileTab>("editor")
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [validationError, setValidationError] = useState("")
  const [past, setPast] = useState<readonly BeatChartDocument[]>([])
  const [future, setFuture] = useState<readonly BeatChartDocument[]>([])
  const playback = useAudioPlayback(project)
  const dirty = useMemo(
    () => JSON.stringify(project) !== JSON.stringify(persistedProject),
    [persistedProject, project],
  )
  useBeforeUnload(dirty)

  function replaceProject(nextProject: BeatChartDocument): void {
    setPast((current) => [...current, project])
    setFuture([])
    setProject(nextProject)
    setValidationError("")
  }

  function undo(): void {
    const previous = past.at(-1)
    if (previous === undefined) return
    setFuture((current) => [project, ...current])
    setPast((current) => current.slice(0, -1))
    setProject(previous)
  }

  function redo(): void {
    const next = future[0]
    if (next === undefined) return
    setPast((current) => [...current, project])
    setFuture((current) => current.slice(1))
    setProject(next)
  }

  function acceptDocument(document: CurrentDocument): void {
    playback.stop()
    setProject(document.project)
    setPersistedProject(document.project)
    setRevision(document.revision)
    setOrigin(document.origin)
    setValidationError("")
    setPast([])
    setFuture([])
  }

  function edit(action: () => typeof project.notes): void {
    try {
      replaceProject({ ...project, notes: action() })
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The note edit is invalid")
    }
  }

  function toggleTap(at: Beat, lane: PanelIndex): void {
    edit(() => toggleBeatPanel(project.notes, project.timing, at, lane))
  }

  function placeHold(head: Beat, tail: Beat, lane: PanelIndex): void {
    edit(() => placeBeatHold(project.notes, project.timing, head, tail, lane))
  }

  function changeSplit(at: Beat, rowsPerMeasure: number): void {
    const result = validateRowsPerMeasureChange(project.timing, project.notes, at, rowsPerMeasure)
    if (result.kind === "error") {
      setValidationError(result.message)
      return
    }
    replaceProject({ ...project, timing: result.timing })
  }

  const save = useDocumentSave({
    csrfToken: bootstrap.csrf_token,
    project,
    projectRef,
    revision,
    onProject: setProject,
    onPersistedProject: setPersistedProject,
    onRevision: setRevision,
    onOrigin: setOrigin,
    onStatus: setStatus,
    onValidationError: setValidationError,
  })

  async function applyProposal(proposal: ChartProposal): Promise<void> {
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
  }

  async function discardProposal(proposal: ChartProposal): Promise<void> {
    await studioApi.discardProposal(bootstrap.csrf_token, proposal.id)
  }

  const proposalOwner = useProposalOwner(bootstrap.proposals ?? [], applyProposal, discardProposal)
  const refreshed = useRefreshedBootstrap(bootstrap, revision, proposalOwner.addProposal)

  return (
    <main className="studio-shell">
      <DocumentToolbar
        bootstrap={refreshed.bootstrap}
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
        onProposal={proposalOwner.addProposal}
        onStatus={setStatus}
        onOpenAgent={() => setTab("agent")}
      />
      <MobileTabs selected={tab} onSelect={setTab} />
      <div className="studio-body">
        {tab === "editor" ? (
          <button
            className="mobile-inspector-trigger"
            type="button"
            aria-expanded={inspectorOpen}
            aria-controls="tools-panel"
            onClick={() => setInspectorOpen(true)}
          >
            Chart info
          </button>
        ) : null}
        <aside
          className={`inspector mobile-${tab}`}
          data-open={inspectorOpen || undefined}
          id="tools-panel"
        >
          <button
            className="mobile-inspector-close"
            type="button"
            onClick={() => setInspectorOpen(false)}
          >
            Close chart info
          </button>
          <Inspector
            project={project}
            validationError={validationError}
            replaceProject={replaceProject}
          />
        </aside>
        <CenterStudio
          tab={tab}
          notes={project.notes}
          timing={project.timing}
          mode={project.mode}
          playback={playback}
          {...(origin === undefined ? {} : { automaticRegions: origin.automatic_regions })}
          onToggleTap={toggleTap}
          onPlaceHold={placeHold}
          onRowsPerMeasureChange={changeSplit}
        />
        <StudioAgentAside
          tab={tab}
          bootstrap={refreshed.bootstrap}
          dirty={dirty}
          revision={revision}
          proposals={proposalOwner.proposals}
          onProposal={proposalOwner.addProposal}
          onBootstrap={refreshed.accept}
          runtimeError={refreshed.refreshError}
          apply={proposalOwner.apply}
          discard={proposalOwner.discard}
        />
      </div>
      <Transport project={project} playback={playback} />
    </main>
  )
}
