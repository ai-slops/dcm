import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { librarySnapshot } from "./library-support.mjs"
import { projectWorkspace } from "./projects-api-support.mjs"
import { restoreProjectUi } from "./projects-ui-support.mjs"
import { createEditorProject } from "./streamlined-editor-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for disposable editor projects",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/tempo-focus")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const ids = {
  projectIds: [],
  componentIds: [],
  chartIds: [],
  selectedProjectId: null,
  activeChartId: undefined,
}
let before

try {
  before = await bootstrap(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  ids.activeChartId = library.active_chart_id
  ids.selectedProjectId = (await projectWorkspace(context, configuration.url)).selected_project_id
  const chart = library.charts.find((candidate) => candidate.id === ids.activeChartId)
  assert.ok(chart)
  await page.goto(configuration.url)
  const project = await createEditorProject(page, {
    name: `Tempo focus ${randomUUID().slice(0, 8)}`,
    songId: chart.song_id,
    chartId: chart.id,
  })
  ids.projectIds.push(project.id)
  await page.goto(new URL(`/projects/${project.id}/edit`, configuration.url).toString())
  await page.getByLabel("Editor lookahead seconds", { exact: true }).fill("4")
  const split = page.getByLabel("Split rows per beat", { exact: true })
  await split.fill("4")

  const halfBeat = page.getByRole("button", { name: "Beat 1/2, add tempo", exact: true })
  await halfBeat.click()
  let dialog = page.getByRole("dialog", { name: "Tempo at beat 1/2", exact: true })
  await dialog.getByLabel("BPM", { exact: true }).fill("150")
  await dialog.getByRole("button", { name: "Add tempo", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await settleFocus(page)
  assert.deepEqual(await focusedElement(page), {
    connected: true,
    label: "Beat 1/2, 150 BPM",
    scroller: false,
    tabIndex: 0,
  })
  await page.screenshot({ path: resolve(evidence, "on-grid-add-focus.png"), fullPage: true })

  await page.getByRole("button", { name: "Beat 1/2, 150 BPM", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Tempo at beat 1/2", exact: true })
  await dialog.getByRole("button", { name: "Remove", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await settleFocus(page)
  assert.deepEqual(await focusedElement(page), {
    connected: true,
    label: "Beat 1/2, add tempo",
    scroller: false,
    tabIndex: 0,
  })

  await split.fill("3")
  const thirdBeat = page.getByRole("button", { name: "Beat 1/3, add tempo", exact: true })
  await thirdBeat.click()
  dialog = page.getByRole("dialog", { name: "Tempo at beat 1/3", exact: true })
  await dialog.getByLabel("BPM", { exact: true }).fill("150")
  await dialog.getByRole("button", { name: "Add tempo", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await split.fill("4")
  const offGridTempo = page.getByRole("button", { name: "Beat 1/3, 150 BPM", exact: true })
  await offGridTempo.click()
  dialog = page.getByRole("dialog", { name: "Tempo at beat 1/3", exact: true })
  await dialog.getByRole("button", { name: "Remove", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await settleFocus(page)
  assert.deepEqual(await focusedElement(page), {
    connected: true,
    label: "Scrollable beat chart lanes",
    scroller: true,
    tabIndex: -1,
  })
  await page.screenshot({ path: resolve(evidence, "off-grid-remove-fallback.png"), fullPage: true })
  console.log(
    "PASS: tempo add/remove returns focus to the stable beat trigger or timeline fallback",
  )
} finally {
  try {
    if (ids.activeChartId !== undefined) await restoreProjectUi(context, configuration.url, ids)
    if (before !== undefined)
      assert.deepEqual(
        (await bootstrap(context, configuration.url)).document.project,
        before.document.project,
      )
  } finally {
    await browser.close()
  }
}

async function settleFocus(page) {
  await page.evaluate(
    () =>
      new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      ),
  )
}

async function focusedElement(page) {
  return page.evaluate(() => {
    const active = document.activeElement
    return {
      connected: active?.isConnected ?? false,
      label: active?.getAttribute("aria-label") ?? "",
      scroller: active?.classList.contains("timeline__scroller") ?? false,
      tabIndex: active instanceof HTMLElement ? active.tabIndex : -1,
    }
  })
}
