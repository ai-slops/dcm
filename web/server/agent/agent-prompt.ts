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
    "Generation projects and reusable components are live durable records. The chart document is a separate legacy editor document.",
    "Use list_songs to discover song IDs before creating a first project, and read_chart to inspect saved inactive generated charts.",
    "Project writes require the run's explicit permission and current revisions. Generated result charts stay inactive and never replace the editor.",
    snapshot.prompt,
  ].join("\n")
}
