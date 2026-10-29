import type { BaseUcsRef } from "../../shared/beat.ts"
import type {
  BeatChartDocument,
  BeatProjectWorkspace,
  BeatReusableComponent,
  GenerationProjectV2,
} from "../../shared/beat-projects.ts"
import type { LibrarySnapshot, SongId } from "../../shared/library.ts"
import type { ProjectCommand, ProjectGenerationResult } from "../../shared/project-commands.ts"
import type {
  ComponentId,
  ComponentKind,
  GenerationProjectId,
} from "../../shared/project-identities.ts"
import { libraryApi } from "../api/library-client.ts"
import { projectsApi } from "../api/projects-client.ts"
import { ProjectComponentLibrary } from "./ProjectComponentLibrary.tsx"
import { ProjectEditorForm } from "./ProjectEditorForm.tsx"
import { ProjectOperations } from "./ProjectOperations.tsx"
import { ProjectWorkspaceList } from "./ProjectWorkspaceList.tsx"
import type { parseBeatProjectForm } from "./project-form.ts"

type ProjectManagerWorkspaceProps = {
  readonly busy: boolean
  readonly creating: boolean
  readonly generation: ProjectGenerationResult | null
  readonly project: GenerationProjectV2 | null
  readonly projectLoading: boolean
  readonly rulesDirty: boolean
  readonly library: LibrarySnapshot
  readonly workspace: BeatProjectWorkspace
  readonly onApply: (componentId: ComponentId) => void
  readonly onCreate: (
    value: ReturnType<typeof parseBeatProjectForm> & {
      readonly songId: SongId
      readonly baseUcsRef: BaseUcsRef
    },
  ) => void
  readonly onDeleteComponent: (component: BeatReusableComponent) => void
  readonly onDeleteProject: (project: BeatProjectWorkspace["projects"][number]) => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onGenerate: (command: ProjectCommand) => void
  readonly onInspect: (id: GenerationProjectId) => void
  readonly onNew: () => void
  readonly onOpenGenerated: () => void
  readonly onPublish: (kind: ComponentKind, name: string) => void
  readonly onSelect: (project: BeatProjectWorkspace["projects"][number]) => void
  readonly onWrite: (value: ReturnType<typeof parseBeatProjectForm>) => void
}

export function ProjectManagerWorkspace(props: ProjectManagerWorkspaceProps) {
  const disabled = props.busy || props.projectLoading
  return (
    <>
      <ProjectWorkspaceList
        busy={disabled}
        workspace={props.workspace}
        inspectedId={props.project?.id ?? null}
        rulesDirty={props.rulesDirty}
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
            library={props.library}
            project={props.creating ? null : props.project}
            onDirtyChange={props.onDirtyChange}
            onLoadBase={loadProjectBase}
            onLoadBaseSources={(songId) => projectsApi.baseSources(songId)}
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

function loadProjectBase(songId: SongId, source: BaseUcsRef): Promise<BeatChartDocument> {
  switch (source.source) {
    case "saved_chart":
      return libraryApi.chart(source.chart_id).then((document) => document.project)
    case "archive_entry":
    case "retained_timing":
      return projectsApi.songTemplate(songId)
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}
