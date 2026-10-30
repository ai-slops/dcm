import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { dragBeatHold } from "./beat-authoring-support.mjs"
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
  saveEditorProject,
} from "./streamlined-editor-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for disposable projects",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/timeline-editor-regressions")
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
  let project = await createEditorProject(page, {
    name: `Timeline regressions ${randomUUID().slice(0, 8)}`,
    songId: chart.song_id,
    chartId: chart.id,
  })
  ids.projectIds.push(project.id)
  const long = await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: project.name,
    chart_artist: project.chart_artist,
    timing: { ...project.timing, duration: { numerator: 1201, denominator: 1 } },
    evaluation_contract: project.evaluation_contract,
    generation_rules: {
      ...project.generation_rules,
      fixed_notes: [
        {
          at: { numerator: 0, denominator: 1 },
          hold: { numerator: 1200, denominator: 1 },
          panel_mask: 1,
        },
      ],
    },
  })
  assert.ok(long.project)
  project = long.project
  await page.goto(new URL(`/projects/${project.id}/edit`, configuration.url).toString())
  await page.getByLabel("Editor lookahead seconds", { exact: true }).fill("0.1")
  await settleTimeline(page)
  assert.equal(await page.locator(".timeline").getAttribute("data-lookahead-seconds"), "0.1")
  const scroller = page.locator(".timeline__scroller")
  const runway = await scroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    headerHeight: element.querySelector(".timeline__header")?.getBoundingClientRect().height ?? 0,
    judgmentHeight:
      element.querySelector(".timeline__playhead")?.getBoundingClientRect().height ?? 0,
    viewportHeight: element.clientHeight,
  }))
  assert.ok(
    runway.scrollHeight <= 4_000_000 + runway.headerHeight + runway.judgmentHeight,
    `Timeline exceeded its fixed runway plus header/judgment flow: ${JSON.stringify(runway)}`,
  )
  const hugeHold = exactNote(page, 0, 1, 0)
  assert.equal(await hugeHold.getAttribute("data-tail-numerator"), "1200")
  const hugeHoldHeight = await hugeHold.evaluate(
    (element) => element.getBoundingClientRect().height,
  )
  assert.ok(
    hugeHoldHeight <= runway.viewportHeight,
    `Huge hold exceeded the visible scroller: hold=${hugeHoldHeight}, viewport=${runway.viewportHeight}, scrollHeight=${runway.scrollHeight}, header=${runway.headerHeight}`,
  )
  assert.equal(await page.locator(".timeline__end-line").count(), 0)
  const noteList = page.locator(".note-list")
  const noteSummary = noteList.locator("summary")
  await noteSummary.scrollIntoViewIfNeeded()
  const summaryBox = await noteSummary.boundingBox()
  assert.ok(
    summaryBox !== null && summaryBox.height >= 44,
    `Desktop note summary was not reachable at 44px: ${JSON.stringify(summaryBox)}`,
  )
  await noteSummary.click()
  assert.equal(await noteList.evaluate((element) => element.open), true)
  assert.ok(
    (await noteList.evaluate((element) => element.getBoundingClientRect().height)) >
      summaryBox.height,
  )
  await noteSummary.click()

  const reset = await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: project.name,
    chart_artist: project.chart_artist,
    timing: { ...project.timing, duration: null },
    evaluation_contract: project.evaluation_contract,
    generation_rules: { ...project.generation_rules, fixed_notes: [] },
  })
  assert.ok(reset.project)
  project = reset.project
  await page.goto(new URL(`/projects/${project.id}/edit`, configuration.url).toString())
  await page.getByLabel("Editor lookahead seconds", { exact: true }).fill("4")
  await page.getByLabel("Split rows per beat", { exact: true }).fill("4")
  await settleTimeline(page)
  await dragBeatHold(page, { head: [0, 1], tail: [2, 1], lane: 0 })
  const hold = exactNote(page, 0, 1, 0)
  await hold.press("Enter")
  await hold.press("h")
  await hold.press("Space")
  const empty = editCell(page, 1, 1, 1)
  await empty.press("Enter")
  await empty.press("h")
  await empty.press("Space")
  assert.equal(await editCell(page, 1, 1, 0).count(), 0)
  let saved = await saveEditorProject(page)
  assert.deepEqual(saved.generation_rules.fixed_notes, [
    { at: { numerator: 0, denominator: 1 }, hold: { numerator: 2, denominator: 1 }, panel_mask: 1 },
  ])

  await scroller.evaluate((element) => {
    element.scrollTop += 80
  })
  const scrollerBox = await scroller.boundingBox()
  const holdBox = await hold.boundingBox()
  assert.ok(scrollerBox && holdBox)
  const bodyY = Math.max(scrollerBox.y + 60, holdBox.y + 4)
  assert.ok(bodyY < holdBox.y + holdBox.height)
  await page.mouse.move(holdBox.x + holdBox.width / 2, bodyY)
  await page.mouse.down()
  await page.mouse.move(holdBox.x + holdBox.width / 2, bodyY + 3)
  await page.mouse.up()
  saved = await saveEditorProject(page)
  assert.deepEqual(saved.generation_rules.fixed_notes, [])

  await editCell(page, 1, 1, 0).click()
  const end = page.locator(".timeline__end-handle")
  await end.click()
  await end.press("ArrowDown")
  await end.press("ArrowUp")
  saved = await saveEditorProject(page)
  const sourceLabel = await end.getAttribute("aria-label")
  await dragEndToBeat(page, 1, 1)
  assert.equal(await end.getAttribute("aria-label"), sourceLabel)
  await page.locator(".timeline__end-line [role='alert']").waitFor()
  assert.deepEqual(await readRuleProject(context, configuration.url, project.id), saved)
  await page.screenshot({ path: resolve(evidence, "invalid-end.png"), fullPage: true })
  await page.getByRole("button", { name: "Use automatic", exact: true }).click()
  await page.screenshot({ path: resolve(evidence, "automatic-end.png"), fullPage: true })

  assert.equal(
    await scroller.evaluate((element) => element.contains(document.querySelector(".note-list"))),
    false,
  )
  await noteList.locator("summary").click()
  assert.ok((await noteList.evaluate((element) => element.getBoundingClientRect().height)) <= 300)
  await page.setViewportSize({ width: 375, height: 1000 })
  await page.reload()
  await page.getByLabel("Split rows per beat", { exact: true }).fill("4")
  await page.getByLabel("Editor lookahead seconds", { exact: true }).fill("4")
  await settleTimeline(page)
  assert.equal(
    await page.getByText("Scroll sideways inside the timeline to reach all 10 lanes.").isVisible(),
    true,
  )
  assert.equal(
    await scroller.evaluate((element) => element.scrollWidth > element.clientWidth),
    true,
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  const tempoTarget = page.getByRole("button", { name: "Beat 1/2, add tempo", exact: true })
  await tempoTarget.scrollIntoViewIfNeeded()
  assert.equal(await tempoTarget.isVisible(), true)
  await tempoTarget.focus()
  await page.screenshot({ path: resolve(evidence, "375-timing-focus.png"), fullPage: true })
  await tempoTarget.click()
  const tempoDialog = page.getByRole("dialog", { name: "Tempo at beat 1/2", exact: true })
  await tempoDialog.waitFor()
  await page.screenshot({ path: resolve(evidence, "375-tempo-dialog.png"), fullPage: true })
  await tempoDialog.getByRole("button", { name: "Close", exact: true }).click()
  await tempoDialog.waitFor({ state: "hidden" })
  await page.screenshot({ path: resolve(evidence, "375-rightmost-gutter.png"), fullPage: true })
  console.log(
    "PASS: bounded long timeline, pointer-only notes, hold jitter deletion, end recovery, note list, and narrow scrolling",
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

async function settleTimeline(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    )
  })
}
