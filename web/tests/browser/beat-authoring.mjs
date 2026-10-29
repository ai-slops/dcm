import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import {
  beatCell,
  createBeatProject,
  dragBeatHold,
  openBeatProject,
  saveBeatProject,
} from "./beat-authoring-support.mjs"
import { librarySnapshot } from "./library-support.mjs"
import {
  acceptedProjectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { openProjectManager, projectUiMutation, restoreProjectUi } from "./projects-ui-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for disposable beat projects",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/beat-authoring")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
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
  const library = await librarySnapshot(context, configuration.url)
  ids.activeChartId = library.active_chart_id
  ids.selectedProjectId = (await projectWorkspace(context, configuration.url)).selected_project_id
  const chart = library.charts.find((candidate) => candidate.id === ids.activeChartId)
  assert.ok(chart)
  await page.goto(configuration.url)
  await openProjectManager(page)
  const created = await createBeatProject(page, {
    name: `박자 기반 조각 검증 ${suffix}`,
    artist: "Browser chart author",
    songId: chart.song_id,
    chartId: chart.id,
  })
  ids.projectIds.push(created.project.id)
  const source = await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: created.project.id,
    base_revision: created.project.revision,
    name: created.project.name,
    chart_artist: created.project.chart_artist,
    timing: {
      ...created.project.timing,
      duration: null,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        },
      ],
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 12 }],
      reference_accents: [],
    },
    evaluation_contract: created.project.evaluation_contract,
    generation_rules: created.project.generation_rules,
  })
  assert.ok(source.project)
  await openBeatProject(page, configuration.url, source.project.id)
  for (const name of ["Tap", "Hold", "Erase", "Select"])
    assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0)
  assert.equal(await page.getByLabel("Selected tick", { exact: true }).count(), 0)
  assert.equal(await page.getByLabel("Selected lane", { exact: true }).count(), 0)
  await beatCell(page, 0, 1, 0).click()
  await dragBeatHold(page, { head: [4, 3], tail: [8, 3], lane: 1 })
  const offset = page.getByLabel("Audio offset (microseconds)", { exact: true })
  await offset.fill("200000")
  await offset.press("Tab")
  const saved = await saveBeatProject(page)
  assert.equal(saved.timing.duration, null)
  assert.equal(saved.timing.offset_micros, 200000)
  assert.deepEqual(saved.generation_rules.fixed_notes, [
    { at: { numerator: 0, denominator: 1 }, hold: { numerator: 0, denominator: 1 }, panel_mask: 1 },
    { at: { numerator: 4, denominator: 3 }, hold: { numerator: 4, denominator: 3 }, panel_mask: 2 },
  ])
  await page.reload()
  await beatCell(page, 0, 1, 0).waitFor()
  assert.match(await beatCell(page, 4, 3, 1).getAttribute("class"), /hold/)
  const fragmentName = `Across BPM ${suffix}`
  await page.getByLabel("Fragment name", { exact: true }).fill(fragmentName)
  await page.getByLabel("Range end beat (exclusive)", { exact: true }).fill("4")
  const published = await projectUiMutation(page, "publish_component", () =>
    page.getByRole("button", { name: "Publish note fragment", exact: true }).click(),
  )
  assert.ok(published.component)
  ids.componentIds.push(published.component.id)
  assert.equal(published.component.value.notes.length, 2)
  await page.getByText(fragmentName, { exact: true }).first().waitFor()
  await page.screenshot({ path: resolve(evidence, "source-and-fragment.png"), fullPage: true })
  const target = await acceptedProjectAction(context, configuration.url, {
    type: "create_project",
    name: `다른 BPM 재사용 ${suffix}`,
    song_id: chart.song_id,
    mode: "Double",
    chart_artist: "Destination author",
    base_ucs_ref: { source: "saved_chart", chart_id: chart.id },
    timing: created.inherited,
    evaluation_contract: created.project.evaluation_contract,
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [],
    },
  })
  assert.ok(target.project)
  ids.projectIds.push(target.project.id)
  const targetTiming = {
    ...saved.timing,
    offset_micros: 0,
    tempo: [
      {
        at: { numerator: 0, denominator: 1 },
        micros_per_beat: { numerator: 400_000, denominator: 1 },
      },
    ],
  }
  await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: target.project.id,
    base_revision: target.project.revision,
    name: target.project.name,
    chart_artist: target.project.chart_artist,
    timing: targetTiming,
    evaluation_contract: target.project.evaluation_contract,
    generation_rules: target.project.generation_rules,
  })
  await openBeatProject(page, configuration.url, target.project.id)
  await page.getByLabel("Note fragment", { exact: true }).selectOption(published.component.id)
  await page.getByLabel("Apply anchor beat", { exact: true }).fill("4")
  const applied = await projectUiMutation(page, "apply_component", () =>
    page.getByRole("button", { name: "Apply note fragment", exact: true }).click(),
  )
  assert.ok(applied.project)
  assert.deepEqual(applied.project.timing, targetTiming)
  assert.deepEqual(applied.project.generation_rules.fixed_notes, [
    { at: { numerator: 4, denominator: 1 }, hold: { numerator: 0, denominator: 1 }, panel_mask: 1 },
    {
      at: { numerator: 16, denominator: 3 },
      hold: { numerator: 4, denominator: 3 },
      panel_mask: 2,
    },
  ])
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 375) {
      await page.locator(".project-grid-workspace").evaluate((element) => {
        element.scrollTop = 0
      })
      await page.locator(".timeline__cell").first().waitFor()
      assert.equal(
        await page.getByText("Scroll sideways inside the grid to reach all 10 lanes.").isVisible(),
        true,
      )
      await page.screenshot({ path: resolve(evidence, "375-beat-grid.png"), fullPage: true })
    }
    if (width < 1200) await page.locator(".project-information").scrollIntoViewIfNeeded()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-beat-project.png`), fullPage: true })
  }
  const collision = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/projects/actions" &&
      response.request().postDataJSON()?.type === "apply_component",
  )
  await page.getByRole("button", { name: "Apply note fragment", exact: true }).click()
  assert.equal((await collision).ok(), false)
  assert.deepEqual(
    await readRuleProject(context, configuration.url, target.project.id),
    applied.project,
  )
  await page.getByRole("alert").first().waitFor()
  await page.screenshot({ path: resolve(evidence, "collision-error.png"), fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        exact_fractional_notes: true,
        inherited_base_timing: true,
        automatic_duration_saved: true,
        fragment_cross_bpm: true,
        collision_preserves_revision: true,
        widths: [1280, 768, 375],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    "PASS: explicit base/artist creation, beat-snapped tap/hold save and reload, automatic duration, cross-BPM fragment reuse, atomic collision rejection, responsive layouts.",
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
