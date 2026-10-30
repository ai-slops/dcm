import assert from "node:assert/strict"

import { projectDialog, projectUiMutation } from "./projects-ui-support.mjs"

export function beatCell(page, numerator, denominator, lane) {
  return page.locator(
    `.timeline__cell[data-beat-numerator="${numerator}"][data-beat-denominator="${denominator}"][data-lane="${lane}"]`,
  )
}

export async function dragBeatHold(page, input) {
  const head = await beatCell(page, ...input.head, input.lane).boundingBox()
  const tail = await beatCell(page, ...input.tail, input.lane).boundingBox()
  assert.ok(head && tail, "The requested hold rows must be visible")
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(tail.x + tail.width / 2, tail.y + tail.height / 2, { steps: 12 })
  await page.mouse.up()
}

export async function createBeatProject(page, input) {
  const dialog = projectDialog(page)
  await dialog.getByRole("button", { name: "New project", exact: true }).click()
  const form = dialog.locator(".project-editor")
  await form.getByLabel("Project name", { exact: true }).fill(input.name)
  await form.getByLabel("Song", { exact: true }).selectOption(input.songId)
  await form.getByLabel("Mode", { exact: true }).selectOption("Double")
  const source = form.getByLabel("Base timing source", { exact: true })
  assert.equal(await source.inputValue(), "", "A base must never silently auto-select")
  await source.selectOption(`chart:${input.chartId}`)
  await form
    .getByRole("button", { name: "Create project", exact: true })
    .waitFor({ state: "visible" })
  await page.waitForFunction(() => {
    const timing = document.querySelector(".project-editor textarea")
    return timing !== null && timing.value !== "" && !timing.disabled
  })
  const timingField = form.getByLabel("Timing", { exact: true })
  const inherited = JSON.parse(await timingField.inputValue())
  const baseResponse = await page
    .context()
    .request.get(new URL(`/api/v1/library/charts/${input.chartId}`, page.url()).toString())
  assert.equal(baseResponse.status(), 200)
  const base = await baseResponse.json()
  assert.deepEqual(inherited, { ...base.project.timing, duration: null })
  const mutation = await projectUiMutation(page, "create_project", () =>
    form.getByRole("button", { name: "Create project", exact: true }).click(),
  )
  assert.ok(mutation.project)
  assert.equal(mutation.project.chart_artist, null)
  assert.deepEqual(mutation.project.base_ucs_ref, {
    source: "saved_chart",
    chart_id: input.chartId,
  })
  assert.deepEqual(
    mutation.project.timing,
    inherited,
    "Creation must inherit the chosen timing exactly",
  )
  assert.equal(
    mutation.project.timing.duration,
    null,
    "New projects must not require a declared end",
  )
  return { project: mutation.project, inherited }
}

export async function saveBeatProject(page) {
  const mutation = await projectUiMutation(page, "write_project", () =>
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.ok(mutation.project)
  return mutation.project
}

export async function openBeatProject(page, url, projectId) {
  await page.goto(new URL(`/projects/${projectId}/edit`, url).toString())
  await page.getByRole("heading", { name: "Project grid authoring", exact: true }).waitFor()
  await page.locator(".timeline__cell").first().waitFor()
}
