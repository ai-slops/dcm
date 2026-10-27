import { useCallback, useEffect, useState } from "react"
import type { GenerationProject, ProjectWorkspace } from "../../shared/generation-projects.ts"
import type { CurrentDocument, Revision, StudioProjectV1 } from "../../shared/index.ts"
import type { ProjectCommand, ProjectGenerationResult } from "../../shared/project-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import { projectsApi } from "../api/projects-client.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { errorMessage } from "./action-utils.ts"
import { LibraryDirtyGuard } from "./LibraryDirtyGuard.tsx"
import { ProjectManagerWorkspace } from "./ProjectManagerWorkspace.tsx"
import { ProjectRuleNavigationSurface } from "./ProjectRuleNavigationSurface.tsx"
import {
  createProjectCommand,
  creatingAfterMutation,
  type PendingRuleNavigation,
  projectAfterMutation,
  publishProjectComponentCommand,
  ruleDirtyAfterMutation,
  writeProjectCommand,
} from "./project-manager-commands.ts"
import type { SaveResult } from "./studio-types.ts"
import { useGeneratedChartOpen } from "./useGeneratedChartOpen.ts"
import { useProjectLoader } from "./useProjectLoader.ts"

type ProjectManagerDialogProps = {
  readonly csrfToken: string
  readonly currentChart: StudioProjectV1
  readonly dirty: boolean
  readonly open: boolean
  readonly revision: Revision
  readonly onClose: () => void
  readonly onDocument: (document: CurrentDocument) => void
  readonly onSave: () => Promise<SaveResult | null>
  readonly onStatus: (status: string) => void
}

export function ProjectManagerDialog(props: ProjectManagerDialogProps) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [project, setProject] = useState<GenerationProject | null>(null)
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof libraryApi.list>> | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ruleDirty, setRuleDirty] = useState(false)
  const [error, setError] = useState("")
  const [generation, setGeneration] = useState<ProjectGenerationResult | null>(null)
  const [pendingRuleNavigation, setPendingRuleNavigation] = useState<PendingRuleNavigation | null>(
    null,
  )
  const {
    loading: projectLoading,
    load: loadInspectedProject,
    invalidate: invalidateProjectLoad,
  } = useProjectLoader({ onProject: setProject, onError: setError })
  const acceptRuleDirty = useCallback((nextDirty: boolean) => {
    setRuleDirty(nextDirty)
    if (nextDirty) setGeneration(null)
  }, [])
  const generatedOpen = useGeneratedChartOpen({
    csrfToken: props.csrfToken,
    dirty: props.dirty,
    generation,
    revision: props.revision,
    onClose: props.onClose,
    onDocument: props.onDocument,
    onSave: props.onSave,
    onStatus: props.onStatus,
  })

  function closeDialog(): void {
    if (generatedOpen.pending) {
      generatedOpen.cancel()
      return
    }
    if (pendingRuleNavigation !== null) {
      setPendingRuleNavigation(null)
      return
    }
    if (ruleDirty) {
      setPendingRuleNavigation({ kind: "close" })
      return
    }
    invalidateProjectLoad()
    props.onClose()
  }

  function requestRuleNavigation(action: PendingRuleNavigation): void {
    if (ruleDirty) setPendingRuleNavigation(action)
    else executeRuleNavigation(action)
  }

  function executeRuleNavigation(action: PendingRuleNavigation | null): void {
    if (action === null) return
    const discarding = pendingRuleNavigation !== null
    setPendingRuleNavigation(null)
    setRuleDirty(false)
    switch (action.kind) {
      case "close":
        invalidateProjectLoad()
        if (discarding) {
          setWorkspace(null)
          setProject(null)
        }
        props.onClose()
        return
      case "new":
        invalidateProjectLoad()
        setCreating(true)
        setProject(null)
        setGeneration(null)
        return
      case "inspect":
        setCreating(false)
        void loadInspectedProject(action.projectId)
        return
      default: {
        const exhaustive: never = action
        void exhaustive
      }
    }
  }

  useEffect(() => {
    if (!props.open) return
    let active = true
    setWorkspace(null)
    setProject(null)
    setCreating(false)
    setRuleDirty(false)
    setError("")
    void Promise.all([projectsApi.list(), libraryApi.list()]).then(
      ([nextWorkspace, librarySnapshot]) => {
        if (!active) return
        setWorkspace(nextWorkspace)
        setLibrary(librarySnapshot)
        const id = nextWorkspace.selected_project_id ?? nextWorkspace.projects[0]?.id
        if (id !== null && id !== undefined) void loadInspectedProject(id)
      },
      (caught: unknown) => active && setError(errorMessage(caught)),
    )
    return () => {
      active = false
      invalidateProjectLoad()
    }
  }, [invalidateProjectLoad, loadInspectedProject, props.open])

  async function command(input: ProjectCommand): Promise<void> {
    setBusy(true)
    setError("")
    try {
      const mutation = await projectsApi.command(props.csrfToken, input)
      setWorkspace(mutation.workspace)
      setProject((current) => projectAfterMutation(current, input, mutation.project))
      setCreating((current) => creatingAfterMutation(current, input, mutation.project))
      setRuleDirty((current) => ruleDirtyAfterMutation(current, input, mutation.project))
      setGeneration(mutation.generation ?? null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function currentProject(): GenerationProject | null {
    if (project === null) setError("Choose a rule project first")
    return project
  }

  return (
    <ActionDialog
      open={props.open}
      busy={busy || generatedOpen.busy}
      title="Projects and library"
      onClose={closeDialog}
    >
      <div className="action-dialog__body project-manager">
        {generatedOpen.pending ? (
          <LibraryDirtyGuard
            busy={generatedOpen.busy}
            onSave={generatedOpen.saveAndOpen}
            onDiscard={generatedOpen.discardAndOpen}
            onCancel={generatedOpen.cancel}
          />
        ) : workspace === null ? (
          <p className="status-copy" role="status">
            {error || "Loading rule projects..."}
          </p>
        ) : (
          <ProjectRuleNavigationSurface
            pending={pendingRuleNavigation !== null}
            onDiscard={() => executeRuleNavigation(pendingRuleNavigation)}
            onCancel={() => setPendingRuleNavigation(null)}
          >
            <ProjectManagerWorkspace
              busy={busy}
              creating={creating}
              currentChart={props.currentChart}
              generation={generation}
              project={project}
              projectLoading={projectLoading}
              rulesDirty={ruleDirty}
              songs={library?.songs ?? []}
              workspace={workspace}
              onNew={() => requestRuleNavigation({ kind: "new" })}
              onInspect={(id) => requestRuleNavigation({ kind: "inspect", projectId: id })}
              onSelect={(summary) =>
                void command({ type: "select_project", project_id: summary.id })
              }
              onDeleteProject={(summary) =>
                void command({
                  type: "delete_project",
                  project_id: summary.id,
                  base_revision: summary.revision,
                })
              }
              onDirtyChange={acceptRuleDirty}
              onCreate={(value) => void command(createProjectCommand(value))}
              onWrite={(value) => {
                const selected = currentProject()
                if (selected !== null) void command(writeProjectCommand(selected, value))
              }}
              onGenerate={(input) => void command(input)}
              onOpenGenerated={generatedOpen.request}
              onPublish={(kind, name) => {
                const selected = currentProject()
                if (selected !== null)
                  void command(publishProjectComponentCommand(selected, kind, name))
              }}
              onApply={(componentId) => {
                const selected = currentProject()
                if (selected !== null)
                  void command({
                    type: "apply_component",
                    project_id: selected.id,
                    base_revision: selected.revision,
                    component_id: componentId,
                  })
              }}
              onDeleteComponent={(component) =>
                void command({
                  type: "delete_component",
                  component_id: component.id,
                  base_revision: component.revision,
                })
              }
            />
          </ProjectRuleNavigationSurface>
        )}
        {error === "" && generatedOpen.error === "" ? null : (
          <p className="operation-result operation-result--error" role="alert">
            {error || generatedOpen.error}
          </p>
        )}
      </div>
    </ActionDialog>
  )
}
