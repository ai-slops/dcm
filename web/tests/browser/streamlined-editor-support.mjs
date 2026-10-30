import assert from "node:assert/strict"

import { projectBaseSources, savedChartBase, sourceKey } from "./project-beat-fixtures.mjs"
import { openProjectManager, projectDialog, projectUiMutation } from "./projects-ui-support.mjs"

export function editCell(page, numerator, denominator, lane) {
  return page.locator(
    `.timeline__cell[data-beat-numerator="${numerator}"][data-beat-denominator="${denominator}"][data-lane="${lane}"]`,
  )
}

export function exactNote(page, numerator, denominator, lane) {
  return page.locator(
    `.timeline__exact-note[data-beat-numerator="${numerator}"][data-beat-denominator="${denominator}"][data-lane="${lane}"]`,
  )
}

export async function createEditorProject(page, input) {
  await openProjectManager(page)
  const dialog = projectDialog(page)
  await dialog.getByRole("button", { name: "New project", exact: true }).click()
  const form = dialog.locator(".project-editor")
  await form.getByLabel("Project name", { exact: true }).fill(input.name)
  await form.getByLabel("Song", { exact: true }).selectOption(input.songId)
  await form.getByLabel("Mode", { exact: true }).selectOption("Double")
  const base = savedChartBase(
    await projectBaseSources(page.context(), page.url(), input.songId),
    input.chartId,
  )
  await form.getByLabel("Base timing source", { exact: true }).selectOption(sourceKey(base.ref))
  assert.equal(await form.getByLabel("Chart artist", { exact: true }).count(), 0)
  const create = form.getByRole("button", { name: "Create project", exact: true })
  await page.waitForFunction(
    () => !document.querySelector(".project-editor button[type='submit']")?.disabled,
  )
  const mutation = await projectUiMutation(page, "create_project", () => create.click())
  assert.ok(mutation.project)
  assert.equal(mutation.project.chart_artist, null)
  return mutation.project
}

export async function saveEditorProject(page) {
  const mutation = await projectUiMutation(page, "write_project", () =>
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.ok(mutation.project)
  return mutation.project
}

export async function dragEndToBeat(page, numerator, denominator) {
  const handle = page.locator(".timeline__end-handle")
  await handle.scrollIntoViewIfNeeded()
  const from = await handle.boundingBox()
  const target = editCell(page, numerator, denominator, 4)
  await target.scrollIntoViewIfNeeded()
  const to = await target.boundingBox()
  const current = await handle.boundingBox()
  assert.ok(from && to && current)
  await page.mouse.move(current.x + Math.min(current.width / 2, 50), current.y + current.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

export async function exportGeneratedChart(context, url, input) {
  const boot = await context.request.get(new URL("/api/v1/bootstrap", url).toString())
  const state = await boot.json()
  const libraryResponse = await context.request.get(new URL("/api/v1/library", url).toString())
  const library = await libraryResponse.json()
  const openedResponse = await context.request.post(
    new URL("/api/v1/library/actions", url).toString(),
    {
      headers: { "x-csrf-token": state.csrf_token },
      data: {
        type: "open_chart",
        chart_id: input.chartId,
        library_revision: library.revision,
        base_revision: state.document.revision,
      },
    },
  )
  assert.equal(openedResponse.status(), 200, await openedResponse.text())
  const opened = await openedResponse.json()
  const response = await context.request.post(new URL("/api/v1/ucs/export", url).toString(), {
    headers: { "x-csrf-token": state.csrf_token },
    data: { base_revision: opened.document.revision, mode: "Double" },
  })
  assert.equal(response.status(), 200, await response.text())
  return response.text()
}
