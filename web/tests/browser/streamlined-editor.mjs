import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { librarySnapshot } from "./library-support.mjs"
import {
  acceptedProjectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { restoreProjectUi } from "./projects-ui-support.mjs"
import {
  createEditorProject,
  dragEndToBeat,
  editCell,
  exactNote,
  exportGeneratedChart,
  saveEditorProject,
} from "./streamlined-editor-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for disposable editor projects",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/streamlined-editor")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
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
  const baseChart = library.charts.find((chart) => chart.id === ids.activeChartId)
  assert.ok(baseChart)
  await page.goto(configuration.url)
  for (const name of [
    "Follow audio",
    "Keyboard hold rows",
    "Document title",
    "Explicit duration beat",
  ])
    assert.equal(await page.getByLabel(name, { exact: true }).count(), 0)
  for (const name of ["Previous measure", "Next measure", "Chart info"])
    assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0)
  assert.equal(await page.locator(".chart-preview, .playfield-preview, .inspector").count(), 0)
  const project = await createEditorProject(page, {
    name: `혼합 split 편집 ${randomUUID().slice(0, 8)}`,
    songId: baseChart.song_id,
    chartId: baseChart.id,
  })
  ids.projectIds.push(project.id)
  await page.goto(new URL(`/projects/${project.id}/edit`, configuration.url).toString())
  await page.locator(".timeline__cell").first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  const split = page.getByLabel("Split rows per beat", { exact: true })
  const lookahead = page.getByLabel("Editor lookahead seconds", { exact: true })
  await lookahead.fill("1")
  await split.fill("3")
  await editCell(page, 1, 3, 0).click()
  const third = exactNote(page, 1, 3, 0)
  await third.waitFor()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const thirdBefore = await third.boundingBox()
  assert.ok(thirdBefore)
  await split.fill("4")
  await editCell(page, 1, 4, 1).waitFor()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const thirdAfter = await third.boundingBox()
  assert.ok(thirdAfter)
  assert.ok(
    Math.abs(thirdBefore.y - thirdAfter.y) <= 1,
    `Changing split moved an existing note visually: ${thirdBefore.y} -> ${thirdAfter.y}`,
  )
  await editCell(page, 1, 4, 1).click()
  const offset = page.getByLabel("Audio offset (ms)", { exact: true })
  await offset.fill("-1.25")
  await offset.press("Tab")
  let saved = await saveEditorProject(page)
  assert.equal(saved.timing.offset_micros, -1250)
  assert.equal(saved.timing.duration, null)
  assert.deepEqual(saved.timing.grid_sections, project.timing.grid_sections)
  assert.deepEqual(saved.generation_rules.fixed_notes, [
    { at: { numerator: 1, denominator: 4 }, hold: { numerator: 0, denominator: 1 }, panel_mask: 2 },
    { at: { numerator: 1, denominator: 3 }, hold: { numerator: 0, denominator: 1 }, panel_mask: 1 },
  ])
  await page.reload()
  await third.waitFor()
  await lookahead.fill("1")
  await split.fill("4")
  assert.equal(await offset.inputValue(), "-1.25")
  const lastHeader = await page.locator(".timeline__header > span").last().boundingBox()
  const lastLane = await page.locator(".timeline__header > span").nth(9).boundingBox()
  assert.ok(lastHeader && lastLane && lastHeader.x >= lastLane.x + lastLane.width - 1)
  await page.getByRole("button", { name: "Beat 1/2, add tempo", exact: true }).click()
  const tempo = page.getByRole("dialog", { name: "Tempo at beat 1/2", exact: true })
  await tempo.getByLabel("BPM", { exact: true }).fill("150")
  await tempo.getByRole("button", { name: "Add tempo", exact: true }).click()
  await tempo.waitFor({ state: "hidden" })
  assert.equal(
    await page.getByRole("button", { name: "Beat 1/2, 150 BPM", exact: true }).count(),
    1,
  )
  const end = page.locator(".timeline__end-handle")
  await end.click()
  assert.equal(await page.getByRole("button", { name: "Use automatic", exact: true }).count(), 1)
  saved = await saveEditorProject(page)
  assert.notEqual(saved.timing.duration, null)
  await lookahead.fill("2")
  await dragEndToBeat(page, 3, 1)
  saved = await saveEditorProject(page)
  assert.deepEqual(saved.timing.duration, { numerator: 3, denominator: 1 })
  assert.deepEqual(saved.timing.tempo[1], {
    at: { numerator: 1, denominator: 2 },
    micros_per_beat: { numerator: 400_000, denominator: 1 },
  })
  await lookahead.fill("4")
  await dragEndToBeat(page, 8, 1)
  saved = await saveEditorProject(page)
  assert.deepEqual(saved.timing.duration, { numerator: 8, denominator: 1 })
  const sourceBeforeExport = await readRuleProject(context, configuration.url, project.id)
  const generated = await acceptedProjectAction(context, configuration.url, {
    type: "generate_project",
    project_id: project.id,
    base_revision: saved.revision,
    name: "Mixed split output",
    seed: "0".repeat(64),
  })
  assert.ok(generated.generation)
  ids.chartIds.push(generated.generation.chart_id)
  const ucs = await exportGeneratedChart(context, configuration.url, {
    chartId: generated.generation.chart_id,
  })
  assert.match(ucs, /:Split=12\r?\n/)
  assert.deepEqual(
    await readRuleProject(context, configuration.url, project.id),
    sourceBeforeExport,
  )
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-editor.png`), fullPage: true })
  }
  await page.getByRole("button", { name: "Use automatic", exact: true }).click()
  saved = await saveEditorProject(page)
  assert.equal(saved.timing.duration, null)
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        mixed_split_source_unchanged: true,
        ucs_output_split: 12,
        offset_micros: -1250,
        tempo_modal: true,
        clickable_draggable_end: true,
        removed_unused_modes: true,
        widths: [1280, 768, 375],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    "PASS: editor-only audio workflow, immutable mixed split3/4 notes, UCS12 output, exact ms offset, right tempo modal and direct end line.",
  )
} catch (error) {
  await page.screenshot({ path: resolve(evidence, "failure.png"), fullPage: true })
  throw error
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
