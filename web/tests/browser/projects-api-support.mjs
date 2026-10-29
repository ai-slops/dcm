import assert from "node:assert/strict"

import {
  BeatProjectWorkspaceSchema,
  GenerationProjectV2Schema,
} from "../../shared/beat-projects.ts"
import { ProjectMutationSchema } from "../../shared/project-commands.ts"
import { librarySnapshot } from "./library-support.mjs"
import { bootstrap } from "./ucs-support.mjs"

export async function projectWorkspace(context, url) {
  const response = await context.request.get(new URL("/api/v1/projects", url).toString())
  assert.equal(response.status(), 200)
  return BeatProjectWorkspaceSchema.parse(await response.json())
}

export async function readRuleProject(context, url, id) {
  const response = await context.request.get(new URL(`/api/v1/projects/${id}`, url).toString())
  assert.equal(response.status(), 200)
  return GenerationProjectV2Schema.parse(await response.json())
}

export async function projectAction(context, url, command) {
  const state = await bootstrap(context, url)
  return context.request.post(new URL("/api/v1/projects/actions", url).toString(), {
    headers: { "x-csrf-token": state.csrf_token },
    data: command,
  })
}

export async function acceptedProjectAction(context, url, command) {
  const response = await projectAction(context, url, command)
  assert.equal(response.status(), 200, await response.text())
  return ProjectMutationSchema.parse(await response.json())
}

export async function cleanProjectArtifacts(context, url, artifacts) {
  const state = await bootstrap(context, url)
  let library = await librarySnapshot(context, url)
  assert.equal(library.active_chart_id, artifacts.activeChartId)
  for (const chartId of artifacts.chartIds) {
    const response = await context.request.post(
      new URL("/api/v1/library/actions", url).toString(),
      {
        headers: { "x-csrf-token": state.csrf_token },
        data: { type: "delete_chart", library_revision: library.revision, chart_id: chartId },
      },
    )
    assert.equal(response.status(), 200)
    library = await librarySnapshot(context, url)
  }
  await acceptedProjectAction(context, url, {
    type: "select_project",
    project_id: artifacts.selectedProjectId,
  })
  for (const id of artifacts.projectIds) {
    const project = await readRuleProject(context, url, id)
    await acceptedProjectAction(context, url, {
      type: "delete_project",
      project_id: id,
      base_revision: project.revision,
    })
  }
  const workspace = await projectWorkspace(context, url)
  for (const id of artifacts.componentIds) {
    const component = workspace.components.find((item) => item.id === id)
    assert.ok(component)
    await acceptedProjectAction(context, url, {
      type: "delete_component",
      component_id: id,
      base_revision: component.revision,
    })
  }
}
