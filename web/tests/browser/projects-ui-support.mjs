import assert from "node:assert/strict"

import { ProjectMutationSchema } from "../../shared/project-commands.ts"
import { librarySnapshot } from "./library-support.mjs"
import { sourceKey, weightedRules } from "./project-beat-fixtures.mjs"
import { cleanProjectArtifacts } from "./projects-api-support.mjs"
import { bootstrap } from "./ucs-support.mjs"

export function projectDialog(page) {
  return page.getByRole("dialog", { name: "Projects and library", exact: true })
}

export async function openProjectManager(page) {
  await page.getByRole("button", { name: "Projects and library", exact: true }).click()
  await projectDialog(page).getByRole("heading", { name: "Rule projects", exact: true }).waitFor()
}

export async function projectUiMutation(page, type, action) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/projects/actions" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().type === type,
  )
  await action()
  const response = await pending
  assert.equal(response.status(), 200, await response.text())
  return ProjectMutationSchema.parse(await response.json())
}

export async function createProjectThroughUi(page, input) {
  const dialog = projectDialog(page)
  await dialog.getByRole("button", { name: "New project", exact: true }).click()
  const form = dialog.locator(".project-editor")
  await form.getByRole("textbox", { name: "Project name", exact: true }).fill(input.name)
  assert.equal(await form.getByRole("combobox", { name: "Mode", exact: true }).inputValue(), "")
  await form.getByRole("combobox", { name: "Song", exact: true }).selectOption(input.songId)
  await form.getByRole("combobox", { name: "Mode", exact: true }).selectOption(input.mode)
  const base = form.getByRole("combobox", { name: "Base timing source", exact: true })
  assert.equal(await base.inputValue(), "")
  await base.selectOption(sourceKey(input.base.ref))
  await page.waitForFunction(() => {
    const form = document.querySelector("dialog[open] .project-editor")
    return form !== null && !form.querySelector('button[type="submit"]').disabled
  })
  const timing = JSON.parse(
    await form.getByRole("textbox", { name: "Timing", exact: true }).inputValue(),
  )
  assert.equal(timing.duration, null)
  assert.ok(input.base.timing.duration)
  const rules = weightedRules({ end: input.base.timing.duration, panelMask: input.mask })
  await form
    .getByRole("textbox", { name: "Generation rules", exact: true })
    .fill(JSON.stringify(rules, null, 2))
  const mutation = await projectUiMutation(page, "create_project", () =>
    form.getByRole("button", { name: "Create project", exact: true }).click(),
  )
  assert.ok(mutation.project)
  await form.getByRole("button", { name: "Save project", exact: true }).waitFor()
  assert.equal(await form.getByRole("combobox", { name: "Mode", exact: true }).isDisabled(), true)
  return mutation.project
}

export async function generateProjectThroughUi(page, name) {
  const dialog = projectDialog(page)
  await dialog.getByRole("textbox", { name: "Chart name", exact: true }).fill(name)
  const mutation = await projectUiMutation(page, "generate_project", () =>
    dialog.getByRole("button", { name: "Generate", exact: true }).click(),
  )
  assert.ok(mutation.generation)
  await dialog.getByRole("button", { name: "Open generated chart", exact: true }).waitFor()
  return mutation.generation
}

export async function openGeneratedThroughUi(page) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/library/actions" &&
      response.request().method() === "POST",
  )
  await projectDialog(page)
    .getByRole("button", { name: "Open generated chart", exact: true })
    .click()
  assert.equal((await pending).status(), 200)
  await projectDialog(page).waitFor({ state: "hidden" })
}

export async function restoreProjectUi(context, url, ids) {
  const current = await bootstrap(context, url)
  const library = await librarySnapshot(context, url)
  if (library.active_chart_id !== ids.activeChartId) {
    const response = await context.request.post(
      new URL("/api/v1/library/actions", url).toString(),
      {
        headers: { "x-csrf-token": current.csrf_token },
        data: {
          type: "open_chart",
          library_revision: library.revision,
          base_revision: current.document.revision,
          chart_id: ids.activeChartId,
        },
      },
    )
    assert.equal(response.status(), 200)
  }
  await cleanProjectArtifacts(context, url, ids)
}
