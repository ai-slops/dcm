import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { dragGridHold, gridCell, waitForGalleryTimeline } from "./grid-gestures.mjs"
import { createTimingZip, libraryAction } from "./hybrid-fixture.mjs"
import { librarySnapshot } from "./library-support.mjs"
import {
  acceptedProjectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { openProjectManager, projectDialog, projectUiMutation } from "./projects-ui-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/hybrid-editor")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
await page.emulateMedia({ reducedMotion: "reduce" })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
let before
let initialWorkspace
let originalChartId
let fixture
let projectId

const expectedTiming = {
  duration_ticks: 24,
  ticks_per_beat: 8,
  offset_micros: 125_000,
  tempo: [
    { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
    { start_tick: 16, micros_per_beat: { numerator: 400_000, denominator: 1 } },
  ],
  reference_accents: [],
}

try {
  before = await bootstrap(context, configuration.url)
  initialWorkspace = await projectWorkspace(context, configuration.url)
  originalChartId = (await librarySnapshot(context, configuration.url)).active_chart_id
  fixture = await createTimingZip(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  const opened = await libraryAction(context, configuration.url, {
    type: "open_chart",
    library_revision: library.revision,
    base_revision: before.document.revision,
    chart_id: fixture.chart.id,
  })
  const changedMusic = {
    ...opened.document.project.music,
    offset_micros: 900_000,
    tempo: [{ start_tick: 0, micros_per_beat: { numerator: 600_000, denominator: 1 } }],
  }
  const changed = await context.request.put(
    new URL("/api/v1/document", configuration.url).toString(),
    {
      headers: { "x-csrf-token": before.csrf_token },
      data: {
        base_revision: opened.document.revision,
        project: { ...opened.document.project, music: changedMusic },
      },
    },
  )
  assert.equal(changed.status(), 200)
  await page.goto(configuration.url)
  await openProjectManager(page)
  await projectDialog(page).getByRole("button", { name: "New project", exact: true }).click()
  const form = projectDialog(page).locator(".project-editor")
  await form
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(`구간 편집 검증 ${randomUUID().slice(0, 8)}`)
  await form.getByRole("combobox", { name: "Song", exact: true }).selectOption(fixture.song.id)
  await form.getByRole("combobox", { name: "Mode", exact: true }).selectOption("Double")
  await page.waitForFunction(() => {
    const value = document.querySelector("dialog[open] .project-editor textarea")?.value
    return value !== undefined && JSON.parse(value).offset_micros === 125000
  })
  assert.deepEqual(
    JSON.parse(await form.getByRole("textbox", { name: "Timing", exact: true }).inputValue()),
    expectedTiming,
  )
  const created = await projectUiMutation(page, "create_project", () =>
    form.getByRole("button", { name: "Create project", exact: true }).click(),
  )
  assert.ok(created.project)
  projectId = created.project.id
  assert.equal(created.project.generation_rules.schema_version, 2)
  assert.deepEqual(created.project.timing, expectedTiming)
  await projectDialog(page).getByRole("link", { name: "Edit grid", exact: true }).click()
  await page.getByRole("heading", { name: "Project grid authoring", exact: true }).waitFor()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await gridCell(page, 0, 0).click()
  await gridCell(page, 0, 0).click()
  await dragGridHold(page, { start: 0, end: 4, lane: 0 })
  const regions = page.getByRole("region", { name: "Automatic regions", exact: true })
  const newRegion = regions
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "New region", exact: true }) })
  await newRegion.getByRole("textbox", { name: "Region name", exact: true }).fill("자동 후렴")
  await newRegion.getByRole("textbox", { name: "Start tick", exact: true }).fill("8")
  await newRegion.getByRole("textbox", { name: "End tick", exact: true }).fill("16")
  await newRegion.getByRole("textbox", { name: "Step ticks", exact: true }).fill("4")
  await newRegion.getByRole("button", { name: "Add region", exact: true }).click()
  assert.ok((await page.locator(".timeline").innerText()).includes("자동 후렴"))
  assert.equal(await gridCell(page, 10, 0).getAttribute("aria-disabled"), "true")
  const tail = page.getByRole("region", { name: "Timing span", exact: true })
  await tail.getByRole("textbox", { name: "Additional ticks", exact: true }).fill("16")
  await tail.getByRole("textbox", { name: "Optional tail BPM", exact: true }).fill("175")
  await tail.getByRole("button", { name: "Add tail", exact: true }).click()
  const saved = await projectUiMutation(page, "write_project", () =>
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.ok(saved.project)
  assert.equal(saved.project.timing.duration_ticks, 40)
  assert.equal(saved.project.timing.offset_micros, expectedTiming.offset_micros)
  assert.deepEqual(saved.project.timing.tempo.slice(0, 2), expectedTiming.tempo)
  assert.deepEqual(saved.project.timing.tempo[2], {
    start_tick: 24,
    micros_per_beat: { numerator: 2_400_000, denominator: 7 },
  })
  assert.deepEqual(saved.project.generation_rules.fixed_notes, [
    { tick: 0, panel_mask: 1, hold_ticks: 4 },
  ])
  assert.equal(saved.project.generation_rules.regions[0].name, "자동 후렴")
  await page.screenshot({
    path: resolve(evidence, "desktop-fixed-auto-timing.png"),
    fullPage: true,
  })
  await page.locator(".timeline__scroller").evaluate((node) => {
    const pitch = Number.parseFloat(getComputedStyle(node).getPropertyValue("--timeline-row-size"))
    node.scrollTop += pitch * 12
  })
  const activeRegionLabel = page.locator(".timeline__active-region > span")
  await activeRegionLabel.waitFor({ state: "visible" })
  assert.ok((await activeRegionLabel.innerText()).includes("자동 후렴"))
  await page.screenshot({ path: resolve(evidence, "continued-region-name.png"), fullPage: true })
  const generated = await projectUiMutation(page, "generate_project", () =>
    page.getByRole("button", { name: "Generate saved chart", exact: true }).click(),
  )
  assert.ok(generated.generation)
  assert.equal(generated.generation.chart.notes.length, 3)
  assert.equal(generated.generation.ucs_validation.valid, true)
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".timeline__row")].slice(0, 2)
      if (rows.length < 2) return false
      const first = rows[0].getBoundingClientRect()
      const second = rows[1].getBoundingClientRect()
      return Math.abs(second.top - first.top - first.height) < 0.6
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-project-grid.png`), fullPage: true })
  }
  await regions.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "375-region-controls.png"), fullPage: true })
  await tail.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "375-tail-controls.png"), fullPage: true })
  await page.getByRole("link", { name: "View generated chart", exact: true }).click()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByLabel("Chart position", { exact: true }).fill("8")
  await page.getByRole("button", { name: "timeline", exact: true }).click()
  await waitForGalleryTimeline(page)
  assert.ok((await page.locator(".timeline").innerText()).includes("자동 후렴"))
  await page.screenshot({ path: resolve(evidence, "generated-range-origin.png"), fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        immutable_zip_timing: true,
        fixed_drag_hold: true,
        named_region_visible: true,
        fixed_cells_protected_from_generation: true,
        exact_tail_bpm: 175,
        original_tempo_prefix_preserved: true,
        generated_notes: 3,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    "PASS: original ZIP timing despite edited chart, project click/drag fixed notes, named protected automatic range, exact tail extension and visible generated origin.",
  )
} finally {
  try {
    if (originalChartId !== undefined) {
      const current = await bootstrap(context, configuration.url)
      let library = await librarySnapshot(context, configuration.url)
      if (library.active_chart_id !== originalChartId) {
        const restored = await libraryAction(context, configuration.url, {
          type: "open_chart",
          library_revision: library.revision,
          base_revision: current.document.revision,
          chart_id: originalChartId,
        })
        library = restored.library
      }
      if (initialWorkspace !== undefined)
        await acceptedProjectAction(context, configuration.url, {
          type: "select_project",
          project_id: initialWorkspace.selected_project_id,
        })
      if (projectId !== undefined) {
        const project = await readRuleProject(context, configuration.url, projectId)
        await acceptedProjectAction(context, configuration.url, {
          type: "delete_project",
          project_id: projectId,
          base_revision: project.revision,
        })
      }
      if (fixture !== undefined) {
        const removed = await libraryAction(context, configuration.url, {
          type: "delete_song",
          library_revision: library.revision,
          song_id: fixture.song.id,
        })
        await libraryAction(context, configuration.url, {
          type: "delete_archive",
          library_revision: removed.library.revision,
          archive_id: fixture.archive.id,
        })
      }
      if (before !== undefined)
        assert.deepEqual(
          (await bootstrap(context, configuration.url)).document.project,
          before.document.project,
        )
    }
  } finally {
    await browser.close()
  }
}
