import type { AgentRunSnapshot } from "../../shared/index.ts"
import type { AgentProjectService } from "./project-tools.ts"

export function selectedProjectContext(projects: AgentProjectService | undefined) {
  if (projects === undefined) return undefined
  const workspace = projects.list()
  if (workspace.selected_project_id === null) return null
  const project = workspace.projects.find(
    (candidate) => candidate.id === workspace.selected_project_id,
  )
  return project === undefined ? null : { id: project.id, revision: project.revision }
}

export function buildAgentPrompt(snapshot: AgentRunSnapshot): string {
  const context = JSON.stringify({
    selected_project: snapshot.selected_project ?? null,
    write_access: snapshot.write_access,
  })
  return [
    `<project-context>${context}</project-context>`,
    "Generation projects and reusable components are live durable records. The concrete chart document is separate from a rule project. Authoring uses exact reduced beat fractions, never global ticks.",
    "Use list_songs to discover song IDs, then list_base_sources to choose an actual server-issued timing reference before creating a project. Use read_chart to inspect saved inactive generated charts.",
    "Creating a project requires an explicit base timing reference, not guessed song metadata. Stored legacy metadata is not authoritative. Editor split is a local placement subdivision and never rewrites existing notes or source timing grids.",
    "Note fragments use relative beat positions. Publish a beat range and apply at an exact beat anchor without changing BPM, silently snapping, or overwriting occupied cells.",
    "Project writes require the run's explicit permission and current revisions. Generated result charts stay inactive and never replace the editor.",
    snapshot.prompt,
  ].join("\n")
}
