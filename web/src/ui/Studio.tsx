import { useMemo, useRef, useState } from "react"

import type {
  Beat,
  BeatChartDocument,
  Bootstrap,
  ChartProposal,
  CurrentDocument,
} from "../../shared/index.ts"
import {
  BeatChartDocumentSchema,
  beatOutputContextFor,
  resolveChartOutputTiming,
} from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { placeBeatHold, toggleBeatPanel } from "../domain/beat-editor.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { CenterStudio } from "./CenterStudio.tsx"
import { DocumentToolbar } from "./DocumentToolbar.tsx"
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
  const [status, setStatus] = useState("Ready")
  const [validationError, setValidationError] = useState("")
  const [past, setPast] = useState<readonly BeatChartDocument[]>([])
  const [future, setFuture] = useState<readonly BeatChartDocument[]>([])
  const dirty = useMemo(
    () => JSON.stringify(project) !== JSON.stringify(persistedProject),
    [persistedProject, project],
  )
  const currentDocument = useMemo<CurrentDocument>(
    () => ({
      project: persistedProject,
      revision,
      ...(origin === undefined ? {} : { origin }),
    }),
    [origin, persistedProject, revision],
  )
  const playbackProject = useMemo<BeatChartDocument>(
    () => ({
      ...project,
      timing:
        resolveChartOutputTiming(project, beatOutputContextFor(currentDocument)) ?? project.timing,
    }),
    [currentDocument, project],
  )
  const playback = useAudioPlayback(playbackProject)
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

  function changeTiming(timing: BeatChartDocument["timing"]): void {
    try {
      replaceProject(projectWithTiming(project, timing))
    } catch (caught) {
      if (caught instanceof Error) {
        setValidationError(caught.message)
        throw caught
      }
      throw caught
    }
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
        document={currentDocument}
        project={project}
        revision={revision}
        dirty={dirty}
        status={status}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
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
        <CenterStudio
          tab={tab}
          notes={project.notes}
          timing={project.timing}
          mode={project.mode}
          playback={playback}
          {...(origin === undefined ? {} : { automaticRegions: origin.automatic_regions })}
          onToggleTap={toggleTap}
          onPlaceHold={placeHold}
          onTimingChange={changeTiming}
        />
        {validationError === "" ? null : (
          <p className="studio-validation-error field-error" role="alert">
            Edit rejected: {validationError}
          </p>
        )}
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
      <Transport project={playbackProject} playback={playback} />
    </main>
  )
}

export function projectWithTiming(
  project: BeatChartDocument,
  timing: BeatChartDocument["timing"],
): BeatChartDocument {
  const parsed = BeatChartDocumentSchema.safeParse({ ...project, timing })
  if (!parsed.success) {
    throw new StudioTimingChangeError(
      parsed.error.issues[0]?.message ?? "The chart timing is invalid.",
    )
  }
  return parsed.data
}

class StudioTimingChangeError extends Error {
  override readonly name = "StudioTimingChangeError"
}
