import type {
  GenerationProjectSummary,
  ProjectWorkspace,
} from "../../shared/generation-projects.ts"
import type { GenerationProjectId } from "../../shared/project-identities.ts"
import { Badge, Button } from "./primitives.tsx"

type ProjectWorkspaceListProps = {
  readonly busy: boolean
  readonly workspace: ProjectWorkspace
  readonly inspectedId: GenerationProjectId | null
  readonly rulesDirty: boolean
  readonly onInspect: (id: GenerationProjectId) => void
  readonly onSelect: (project: GenerationProjectSummary) => void
  readonly onDelete: (project: GenerationProjectSummary) => void
  readonly onNew: () => void
}

export function ProjectWorkspaceList(props: ProjectWorkspaceListProps) {
  return (
    <section className="project-workspace-list" aria-labelledby="projects-heading">
      <div className="library-section__heading project-section-heading">
        <div>
          <h3 id="projects-heading">Rule projects</h3>
          <p className="status-copy">Song-bound timing, evaluation, and generation rules.</p>
        </div>
        <Button disabled={props.busy} onClick={props.onNew}>
          New project
        </Button>
      </div>
      {props.workspace.projects.length === 0 ? (
        <p className="status-copy">No rule projects yet.</p>
      ) : (
        <ul className="project-list">
          {props.workspace.projects.map((project) => {
            const selected = project.id === props.workspace.selected_project_id
            return (
              <li key={project.id} data-active={project.id === props.inspectedId}>
                <button
                  className="project-list__inspect"
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onInspect(project.id)}
                >
                  <strong>{project.name}</strong>
                  <small>
                    {project.mode} · revision {project.revision}
                  </small>
                </button>
                <div className="cluster">
                  {selected ? <Badge tone="success">Agent context</Badge> : null}
                  <Button disabled={props.busy || selected} onClick={() => props.onSelect(project)}>
                    Select
                  </Button>
                  {props.busy || props.rulesDirty ? null : (
                    <a className="button" href={`/projects/${project.id}/edit`}>
                      Edit grid
                    </a>
                  )}
                  <Button
                    variant="danger"
                    disabled={props.busy}
                    onClick={() => props.onDelete(project)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
