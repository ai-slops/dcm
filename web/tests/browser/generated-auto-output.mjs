import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { compatibleEvaluationContract } from "../../server/library/project-factory.ts"
import { nativeDocumentFor } from "../../server/native/beat-document.ts"
import { NativeBeatUcsService } from "../../server/native/beat-ucs.ts"
import { beatOutputContextFor } from "../../shared/beat-output.ts"
import { librarySnapshot } from "./library-support.mjs"
import { projectBaseSources, savedChartBase } from "./project-beat-fixtures.mjs"
import {
  acceptedProjectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { restoreProjectUi } from "./projects-ui-support.mjs"
import { exportGeneratedChart } from "./streamlined-editor-support.mjs"
import { downloadBeatUcs } from "./ucs-beat-support.mjs"
import { bootstrap, browserConfiguration, ownedMutation, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for disposable projects",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/generated-auto-output")
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
const zero = { numerator: 0, denominator: 1 }
const end = { numerator: 4, denominator: 1 }
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
let before

try {
  before = await bootstrap(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  ids.activeChartId = library.active_chart_id
  ids.selectedProjectId = (await projectWorkspace(context, configuration.url)).selected_project_id
  const active = library.charts.find((chart) => chart.id === ids.activeChartId)
  assert.ok(active)
  const base = savedChartBase(
    await projectBaseSources(context, configuration.url, active.song_id),
    active.id,
  )
  const created = await acceptedProjectAction(context, configuration.url, {
    type: "create_project",
    name: `Generated auto extent ${randomUUID().slice(0, 8)}`,
    song_id: active.song_id,
    mode: "Double",
    base_ucs_ref: base.ref,
    timing: { ...base.timing, duration: null },
    evaluation_contract: compatibleEvaluationContract(before.document.project, end),
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [],
      regions: [],
    },
  })
  assert.ok(created.project)
  let project = created.project
  ids.projectIds.push(project.id)
  const audioResponse = await context.request.get(
    new URL("/api/v1/audio", configuration.url).toString(),
  )
  assert.equal(audioResponse.status(), 200)
  const audio = {
    bytes: await audioResponse.body(),
    format: before.document.project.audio_asset.format,
    digest: before.document.project.audio_sha256,
  }

  for (const panelMask of [1, 0]) {
    const written = await acceptedProjectAction(context, configuration.url, {
      type: "write_project",
      project_id: project.id,
      base_revision: project.revision,
      name: project.name,
      chart_artist: project.chart_artist,
      timing: { ...project.timing, duration: end },
      evaluation_contract: project.evaluation_contract,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [],
        regions: [
          {
            id: randomUUID(),
            name: "Trailing rest region",
            rules: {
              start: zero,
              end,
              step: { numerator: 1, denominator: 1 },
              pattern: [0, 0, 0, panelMask].map((panel_mask) => ({
                choices: [{ panel_mask, hold: zero, weight: 1 }],
              })),
            },
          },
        ],
      },
    })
    assert.ok(written.project)
    project = written.project
    const generated = await acceptedProjectAction(context, configuration.url, {
      type: "generate_project",
      project_id: project.id,
      base_revision: project.revision,
      name: `Automatic output ${panelMask}`,
      seed: "0".repeat(64),
    })
    assert.ok(generated.generation)
    ids.chartIds.push(generated.generation.chart_id)
    await exportGeneratedChart(context, configuration.url, {
      chartId: generated.generation.chart_id,
    })
    await page.goto(configuration.url)
    await page.getByText("Audio ready", { exact: true }).waitFor()
    await page.getByRole("button", { name: "Use automatic", exact: true }).click()
    const saved = await ownedMutation(page, "/api/v1/document", () =>
      page.getByRole("button", { name: "Save", exact: true }).click(),
    )
    assert.equal(saved.project.timing.duration, null)
    assert.equal(saved.project.notes.length, panelMask === 0 ? 0 : 1)
    const scrubber = page.getByLabel("Chart beat position", { exact: true })
    assert.equal(await scrubber.getAttribute("max"), "4")
    assert.equal(await scrubber.isEnabled(), true)
    assert.match(await scrubber.getAttribute("aria-valuetext"), /of 4\.000$/)
    assert.deepEqual(saved.origin.automatic_regions[0].end, end)
    assert.match(await page.locator(".timeline__end-handle").getAttribute("aria-label"), /beat 4$/)
    const native = nativeDocumentFor(saved.project, beatOutputContextFor(saved))
    assert.equal(native.music.duration_ticks / native.music.ticks_per_beat, 4)

    await page.getByRole("button", { name: "Generate and export", exact: true }).click()
    const nativeDialog = page.getByRole("dialog", { name: "Native tools", exact: true })
    const evaluate = nativeDialog.getByRole("button", { name: "Evaluate", exact: true })
    assert.equal(await evaluate.isEnabled(), true)
    const pending = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/evaluations",
    )
    await evaluate.click()
    assert.equal((await pending).status(), 200)
    await nativeDialog
      .locator(".operation-result")
      .filter({ hasText: /(?:Accepted|Rejected) by/ })
      .waitFor()
    await page.screenshot({ path: resolve(evidence, `native-${panelMask}.png`), fullPage: true })
    await nativeDialog.getByRole("button", { name: "Close", exact: true }).click()

    const output = resolve(evidence, `automatic-${panelMask}.ucs`)
    await downloadBeatUcs(page, output, "Double")
    const imported = await new NativeBeatUcsService(repoRoot).import(readFileSync(output), audio)
    assert.deepEqual(imported.timing.duration, end)
    assert.deepEqual(imported.notes, saved.project.notes)
    assert.deepEqual((await bootstrap(context, configuration.url)).document, saved)
    await page.screenshot({ path: resolve(evidence, `automatic-${panelMask}.png`), fullPage: true })
    project = await readRuleProject(context, configuration.url, project.id)
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS: generated trailing-rest and region-only Auto saves agree with editor, native tools and UCS without rewriting source or origin",
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
