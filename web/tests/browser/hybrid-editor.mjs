import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { beatCell, dragBeatHold } from "./beat-authoring-support.mjs"
import { waitForGalleryTimeline } from "./grid-gestures.mjs"
import { createTimingZip, libraryAction } from "./hybrid-fixture.mjs"
import { librarySnapshot } from "./library-support.mjs"
import {
  archiveTimingBase,
  assertExactTailTiming,
  automaticTiming,
  projectBaseSources,
  sourceKey,
  timingWithExactTail,
} from "./project-beat-fixtures.mjs"
import {
  acceptedProjectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { openProjectManager, projectDialog, projectUiMutation } from "./projects-ui-support.mjs"
import { verifyResponsiveProjectGrid } from "./projects-ui-verification.mjs"
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

try {
  before = await bootstrap(context, configuration.url)
  initialWorkspace = await projectWorkspace(context, configuration.url)
  originalChartId = (await librarySnapshot(context, configuration.url)).active_chart_id
  fixture = await createTimingZip(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  const base = archiveTimingBase(
    await projectBaseSources(context, configuration.url, fixture.song.id),
  )
  const expectedTiming = automaticTiming(base)
  const opened = await libraryAction(context, configuration.url, {
    type: "open_chart",
    library_revision: library.revision,
    base_revision: before.document.revision,
    chart_id: fixture.chart.id,
  })
  const changedTiming = {
    ...opened.document.project.timing,
    offset_micros: 900_000,
    tempo: [
      {
        at: { numerator: 0, denominator: 1 },
        micros_per_beat: { numerator: 600_000, denominator: 1 },
      },
    ],
  }
  const changed = await context.request.put(
    new URL("/api/v1/document", configuration.url).toString(),
    {
      headers: { "x-csrf-token": before.csrf_token },
      data: {
        base_revision: opened.document.revision,
        project: { ...opened.document.project, timing: changedTiming },
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
  await form.getByRole("textbox", { name: "Chart artist", exact: true }).fill("Hybrid UI Author")
  await form
    .getByRole("combobox", { name: "Base timing source", exact: true })
    .selectOption(sourceKey(base.ref))
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
  const extendedTiming = timingWithExactTail(created.project.timing, base.timing)
  await form
    .getByRole("textbox", { name: "Timing", exact: true })
    .fill(JSON.stringify(extendedTiming, null, 2))
  const timed = await projectUiMutation(page, "write_project", () =>
    form.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.ok(timed.project)
  await projectDialog(page).getByRole("link", { name: "Edit grid", exact: true }).click()
  await page.getByRole("heading", { name: "Project grid authoring", exact: true }).waitFor()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await beatCell(page, 0, 1, 0).click()
  await beatCell(page, 0, 1, 0).click()
  await dragBeatHold(page, { head: [0, 1], tail: [1, 2], lane: 0 })
  const regions = page.getByRole("region", { name: "Automatic regions", exact: true })
  const newRegion = regions
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "New region", exact: true }) })
  await newRegion.getByRole("textbox", { name: "Region name", exact: true }).fill("자동 후렴")
  await newRegion.getByRole("textbox", { name: "Start beat", exact: true }).fill("1")
  await newRegion.getByRole("textbox", { name: "End beat (exclusive)", exact: true }).fill("2")
  await newRegion.getByRole("textbox", { name: "Step beat", exact: true }).fill("1/2")
  await newRegion.getByRole("button", { name: "Add region", exact: true }).click()
  assert.ok((await page.locator(".timeline").innerText()).includes("자동 후렴"))
  assert.equal(await beatCell(page, 3, 2, 0).getAttribute("aria-disabled"), "true")
  const saved = await projectUiMutation(page, "write_project", () =>
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  )
  assert.ok(saved.project)
  assertExactTailTiming(saved.project.timing, base.timing)
  assert.deepEqual(saved.project.generation_rules.fixed_notes, [
    {
      at: { numerator: 0, denominator: 1 },
      panel_mask: 1,
      hold: { numerator: 1, denominator: 2 },
    },
  ])
  assert.equal(saved.project.generation_rules.regions[0].name, "자동 후렴")
  await page.screenshot({
    path: resolve(evidence, "desktop-fixed-auto-timing.png"),
    fullPage: true,
  })
  await beatCell(page, 1, 1, 0).scrollIntoViewIfNeeded()
  const activeRegionLabel = page.locator(".timeline__region-label").filter({ hasText: "자동 후렴" })
  await activeRegionLabel.waitFor({ state: "visible" })
  await page.screenshot({ path: resolve(evidence, "continued-region-name.png"), fullPage: true })
  const generated = await projectUiMutation(page, "generate_project", () =>
    page.getByRole("button", { name: "Generate saved chart", exact: true }).click(),
  )
  assert.ok(generated.generation)
  assert.equal(generated.generation.chart.notes.length, 3)
  assert.equal(generated.generation.ucs_validation.valid, true)
  await verifyResponsiveProjectGrid(page, evidence)
  await regions.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "375-region-controls.png"), fullPage: true })
  await page
    .getByRole("region", { name: "Project information", exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "375-timing-controls.png"), fullPage: true })
  await page.getByRole("link", { name: "View generated chart", exact: true }).click()
  await page.getByText("Audio ready", { exact: true }).waitFor()
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
