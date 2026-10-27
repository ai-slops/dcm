import type {
  GenerationProject,
  GenerationProjectSummary,
  ProjectWorkspace,
  ReusableComponentSummary,
} from "../../shared/generation-projects.ts"
import type { StudioProjectV1 } from "../../shared/index.ts"
import type { LibraryChart, LibrarySong, SongId } from "../../shared/library.ts"
import type { ProjectCommand, ProjectGenerationResult } from "../../shared/project-commands.ts"
import type {
  ComponentId,
  ComponentKind,
  GenerationProjectId,
} from "../../shared/project-identities.ts"
import { libraryApi } from "../api/library-client.ts"
import { ProjectComponentLibrary } from "./ProjectComponentLibrary.tsx"
import { ProjectEditorForm } from "./ProjectEditorForm.tsx"
import { ProjectOperations } from "./ProjectOperations.tsx"
import { ProjectWorkspaceList } from "./ProjectWorkspaceList.tsx"
import type { parseProjectForm } from "./project-form.ts"

type ProjectManagerWorkspaceProps = {
  readonly busy: boolean
  readonly charts: readonly LibraryChart[]
  readonly creating: boolean
  readonly currentChart: StudioProjectV1
  readonly generation: ProjectGenerationResult | null
  readonly project: GenerationProject | null
  readonly projectLoading: boolean
  readonly rulesDirty: boolean
  readonly songs: readonly LibrarySong[]
  readonly workspace: ProjectWorkspace
  readonly onApply: (componentId: ComponentId) => void
  readonly onCreate: (
    value: ReturnType<typeof parseProjectForm> & { readonly songId: SongId },
  ) => void
  readonly onDeleteComponent: (component: ReusableComponentSummary) => void
  readonly onDeleteProject: (project: GenerationProjectSummary) => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onGenerate: (command: ProjectCommand) => void
  readonly onInspect: (id: GenerationProjectId) => void
  readonly onNew: () => void
  readonly onOpenGenerated: () => void
  readonly onPublish: (kind: ComponentKind, name: string) => void
  readonly onSelect: (project: GenerationProjectSummary) => void
  readonly onWrite: (value: ReturnType<typeof parseProjectForm>) => void
}

export function ProjectManagerWorkspace(props: ProjectManagerWorkspaceProps) {
  const disabled = props.busy || props.projectLoading
  return (
    <>
      <ProjectWorkspaceList
        busy={disabled}
        workspace={props.workspace}
        inspectedId={props.project?.id ?? null}
        onNew={props.onNew}
        onInspect={props.onInspect}
        onSelect={props.onSelect}
        onDelete={props.onDeleteProject}
      />
      <section className="project-editor-section" aria-labelledby="project-editor-heading">
        <div className="library-section__heading">
          <h3 id="project-editor-heading">
            {props.creating || props.project === null ? "New rule project" : "Project rules"}
          </h3>
          <p className="status-copy">
            Mode is fixed after creation. JSON is validated before mutation.
          </p>
        </div>
        {props.projectLoading ? (
          <p className="status-copy" role="status">
            Loading project rules...
          </p>
        ) : (
          <ProjectEditorForm
            key={props.project?.id ?? "new"}
            busy={props.busy}
            currentChart={props.currentChart}
            project={props.creating ? null : props.project}
            songs={props.songs}
            onDirtyChange={props.onDirtyChange}
            onLoadSongProject={async (songId) => {
              const chart = props.charts.find((candidate) => candidate.song_id === songId)
              return chart === undefined ? null : (await libraryApi.chart(chart.id)).project
            }}
            onCreate={props.onCreate}
            onWrite={props.onWrite}
          />
        )}
      </section>
      <ProjectOperations
        busy={disabled}
        rulesDirty={props.rulesDirty}
        project={props.project}
        generation={props.generation}
        onCommand={props.onGenerate}
        onOpen={props.onOpenGenerated}
      />
      <ProjectComponentLibrary
        busy={disabled}
        rulesDirty={props.rulesDirty}
        workspace={props.workspace}
        selectedProjectId={props.project?.id ?? null}
        onPublish={props.onPublish}
        onApply={props.onApply}
        onDelete={props.onDeleteComponent}
      />
    </>
  )
}
