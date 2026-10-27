import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { librarySnapshot } from "./library-support.mjs"
import { projectWorkspace, readRuleProject } from "./projects-api-support.mjs"
import {
  createProjectThroughUi,
  generateProjectThroughUi,
  openGeneratedThroughUi,
  openProjectManager,
  projectDialog,
  projectUiMutation,
  restoreProjectUi,
} from "./projects-ui-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/projects-ui")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
await page.emulateMedia({ reducedMotion: "reduce" })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text())
})
await page.addInitScript(() => {
  window.Audio = new Proxy(window.Audio, {
    construct(Target, args) {
      const audio = new Target(...args)
      window.__studioAudio = audio
      return audio
    },
  })
})
const ids = {
  projectIds: [],
  componentIds: [],
  chartIds: [],
  selectedProjectId: null,
  activeChartId: undefined,
}
const suffix = randomUUID().slice(0, 8)
let before

try {
  before = await bootstrap(context, configuration.url)
  const initial = await projectWorkspace(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  ids.selectedProjectId = initial.selected_project_id
  ids.activeChartId = library.active_chart_id
  const songId = library.charts.find((chart) => chart.id === library.active_chart_id)?.song_id
  assert.ok(songId)
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await openProjectManager(page)
  const single = await createProjectThroughUi(page, {
    name: `검증 Single 규칙 ${suffix}`,
    songId,
    mode: "Single",
    mask: 1,
  })
  ids.projectIds.push(single.id)
  const singleResult = await generateProjectThroughUi(page, `Single output ${suffix}`)
  ids.chartIds.push(singleResult.chart_id)
  await page.screenshot({ path: resolve(evidence, "single-rules-and-result.png") })
  await openGeneratedThroughUi(page)
  assert.equal(await page.locator(".timeline__header > span").count(), 6)
  assert.equal(await page.getByRole("button", { name: /^R .*tick/ }).count(), 0)
  assert.equal(await page.locator(".chart-preview__receptors > span").count(), 5)
  const exact = page.getByLabel("Exact preview lookahead seconds", { exact: true })
  const range = page.getByLabel("Preview lookahead range", { exact: true })
  await exact.fill("0.25")
  assert.equal(await range.inputValue(), "0.25")
  await page.screenshot({ path: resolve(evidence, "single-preview-025.png") })
  await exact.fill("")
  await page
    .getByRole("alert")
    .filter({ hasText: /lookahead|seconds|number/i })
    .waitFor()
  assert.equal(await range.inputValue(), "0.25")
  await exact.fill("0.5")
  assert.equal(await range.inputValue(), "0.5")
  await range.fill("0.1")
  assert.equal(await exact.inputValue(), "0.1")
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(
    () => window.__studioAudio.currentTime > 0.2 && !window.__studioAudio.paused,
  )
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await openProjectManager(page)
  const form = projectDialog(page).locator(".project-editor")
  await form.getByRole("button", { name: "Save project", exact: true }).waitFor()
  const changedRules = {
    ...single.generation_rules,
    step_ticks: Math.max(1, Math.floor(single.generation_rules.step_ticks / 2)),
  }
  await form
    .getByRole("textbox", { name: "Generation rules", exact: true })
    .fill(JSON.stringify(changedRules, null, 2))
  assert.equal(
    await projectDialog(page).getByRole("button", { name: "Generate", exact: true }).isDisabled(),
    true,
  )
  await projectDialog(page).getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("alertdialog")
    .filter({ hasText: /unsaved/i })
    .waitFor()
  await page.screenshot({ path: resolve(evidence, "unsaved-rule-guard.png") })
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click()
  assert.deepEqual(
    JSON.parse(
      await form.getByRole("textbox", { name: "Generation rules", exact: true }).inputValue(),
    ),
    changedRules,
  )
  const saved = await projectUiMutation(page, "write_project", () =>
    form.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.equal(saved.project.generation_rules.step_ticks, changedRules.step_ticks)
  const components = projectDialog(page).getByRole("region", {
    name: "Reusable components",
    exact: true,
  })
  const componentName = `재사용 규칙 ${suffix}`
  await components
    .getByRole("combobox", { name: "Component kind", exact: true })
    .selectOption("generator")
  await components.getByRole("textbox", { name: "Component name", exact: true }).fill(componentName)
  const published = await projectUiMutation(page, "publish_component", () =>
    components.getByRole("button", { name: "Publish", exact: true }).click(),
  )
  assert.ok(published.component)
  ids.componentIds.push(published.component.id)
  await components.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "reusable-component.png") })
  const double = await createProjectThroughUi(page, {
    name: `검증 Double 규칙 ${suffix}`,
    songId,
    mode: "Double",
    mask: 32,
  })
  ids.projectIds.push(double.id)
  const componentRow = components
    .getByRole("listitem")
    .filter({ has: page.getByText(componentName, { exact: true }) })
  const applied = await projectUiMutation(page, "apply_component", () =>
    componentRow.getByRole("button", { name: "Apply", exact: true }).click(),
  )
  assert.deepEqual(applied.project.generation_rules, saved.project.generation_rules)
  const rightRules = {
    ...applied.project.generation_rules,
    pattern: [{ choices: [{ panel_mask: 32, hold_ticks: 0, weight: 1 }] }],
  }
  await form
    .getByRole("textbox", { name: "Generation rules", exact: true })
    .fill(JSON.stringify(rightRules, null, 2))
  await projectUiMutation(page, "write_project", () =>
    form.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  const doubleResult = await generateProjectThroughUi(page, `Double output ${suffix}`)
  ids.chartIds.push(doubleResult.chart_id)
  assert.ok(doubleResult.chart.notes.every((note) => note.panel_mask === 32))
  await openGeneratedThroughUi(page)
  assert.equal(await page.locator(".timeline__header > span").count(), 11)
  assert.equal(await page.locator(".chart-preview__receptors > span").count(), 10)
  const scroller = await page.locator(".timeline__scroller").boundingBox()
  const lastLane = await page.locator(".timeline__header > span").last().boundingBox()
  assert.ok(scroller && lastLane)
  assert.ok(
    lastLane.x + lastLane.width <= scroller.x + scroller.width + 1,
    "The final Double lane must fit the desktop timeline without horizontal clipping",
  )
  await page.screenshot({ path: resolve(evidence, "double-preview.png") })
  const gallery = await context.newPage()
  gallery.on("pageerror", (error) => errors.push(error.message))
  await gallery.emulateMedia({ reducedMotion: "reduce" })
  await gallery.goto(
    new URL(`/previews?chart=${singleResult.chart_id}`, configuration.url).toString(),
  )
  await gallery.getByText("Audio ready", { exact: true }).waitFor()
  await gallery.getByRole("button", { name: "First note", exact: true }).click()
  await gallery.getByLabel("Exact preview lookahead seconds", { exact: true }).fill("0.25")
  for (const width of [1280, 768, 375]) {
    await gallery.setViewportSize({ width, height: 1000 })
    assert.equal(await gallery.locator(".chart-preview__receptors > span").count(), 5)
    assert.equal(
      await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await gallery.screenshot({
      path: resolve(evidence, `${width}-single-player.png`),
      fullPage: true,
    })
  }
  await gallery.getByRole("button", { name: "pads", exact: true }).click()
  await gallery.mouse.move(0, 0)
  await gallery.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    )
  })
  assert.equal(await gallery.locator(".pad--right").count(), 0)
  await gallery.screenshot({ path: resolve(evidence, "375-single-pads.png"), fullPage: true })
  await gallery.close()
  await page.setViewportSize({ width: 375, height: 900 })
  await openProjectManager(page)
  await projectDialog(page)
    .locator(".project-editor")
    .getByRole("button", { name: "Save project", exact: true })
    .waitFor()
  await page.screenshot({ path: resolve(evidence, "375-projects.png") })
  await components.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "375-components.png") })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal((await readRuleProject(context, configuration.url, single.id)).mode, "Single")
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        single_lanes: 5,
        double_lanes: 10,
        exact_lookahead_seconds: [0.1, 0.25, 0.5],
        unsaved_rules_preserved: true,
        reusable_component_applied: true,
        real_native_results: 2,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    "PASS: required project modes, native result opening, 5/10-lane UI, precise lookahead, dirty rule guard, component reuse and phone layout.",
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
