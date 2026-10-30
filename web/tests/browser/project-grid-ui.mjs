import assert from "node:assert/strict"
import { mkdir, readFile } from "node:fs/promises"

import { chromium } from "playwright"

const url = process.env.STUDIO_BROWSER_URL ?? "http://127.0.0.1:5180"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium"
const evidenceDirectory = process.env.PROJECT_GRID_EVIDENCE_DIR
const music = JSON.parse(
  await readFile(new URL("../../../examples/feedback/music.json", import.meta.url), "utf8"),
)
const evaluation = JSON.parse(
  await readFile(new URL("../../../examples/feedback/contract.json", import.meta.url), "utf8"),
)
const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  song: "00000000-0000-4000-8000-000000000002",
  region: "00000000-0000-4000-8000-000000000003",
  chart: "00000000-0000-4000-8000-000000000004",
}
const timing = {
  duration_ticks: music.duration_ticks,
  ticks_per_beat: music.ticks_per_beat,
  offset_micros: music.offset_micros,
  tempo: music.tempo,
  reference_accents: music.reference_accents,
}
let project = {
  schema_version: 1,
  id: ids.project,
  revision: 3,
  name: "Hybrid authoring QA",
  song_id: ids.song,
  mode: "Double",
  applied_components: {},
  timing,
  evaluation_contract: evaluation,
  generation_rules: {
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [{ tick: 0, panel_mask: 1, hold_ticks: 0 }],
    regions: [
      {
        id: ids.region,
        name: "Verse",
        rules: {
          start_tick: 8,
          end_tick: 24,
          step_ticks: 4,
          pattern: [{ choices: [{ panel_mask: 2, hold_ticks: 0, weight: 1 }] }],
        },
      },
    ],
  },
}
let saveAttempts = 0
const document = {
  schema_version: 1,
  title: "Stored song",
  artist: "Stored artist",
  music,
  chart: { ticks_per_beat: music.ticks_per_beat, span_ticks: music.duration_ticks, notes: [] },
  evaluation_contract: evaluation,
  audio_asset: { format: "wav", byte_length: 0 },
  ucs_mode: "Double",
}
const library = {
  revision: 1,
  active_chart_id: ids.chart,
  songs: [
    {
      id: ids.song,
      title: "Stored song",
      artist: "Stored artist",
      audio: { format: "wav", byte_length: 0, sha256: "0".repeat(64) },
    },
  ],
  charts: [
    {
      id: ids.chart,
      song_id: ids.song,
      name: "Saved chart",
      mode: "Double",
      note_count: 0,
      hold_count: 0,
      ticks_per_beat: music.ticks_per_beat,
      duration_ticks: music.duration_ticks,
    },
  ],
  archives: [],
}
const workspace = () => ({
  revision: project.revision,
  selected_project_id: ids.project,
  projects: [
    {
      schema_version: 1,
      id: ids.project,
      revision: project.revision,
      name: project.name,
      song_id: ids.song,
      mode: "Double",
      applied_components: {},
    },
  ],
  components: [],
})

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text())
})
await page.route("**/api/v1/bootstrap", (route) =>
  route.fulfill({
    json: {
      document: { revision: 0, project: document },
      csrf_token: "csrf",
      session_id: "qa",
      native: { ready: true, message: "Ready" },
      agent: { configured: false, provider: null, model: null, source: "off" },
    },
  }),
)
await page.route(`**/api/v1/projects/${ids.project}`, (route) => route.fulfill({ json: project }))
await page.route("**/api/v1/projects/song-template/**", (route) =>
  route.fulfill({ json: document }),
)
await page.route("**/api/v1/library", (route) => route.fulfill({ json: library }))
await page.route("**/api/v1/projects/actions", async (route) => {
  const input = route.request().postDataJSON()
  assert.equal(input.type, "write_project")
  assert.equal(input.base_revision, project.revision)
  saveAttempts += 1
  if (saveAttempts === 1) {
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: "project_revision_conflict",
          message: "Project changed in another editor",
          current_revision: project.revision + 1,
        },
      },
    })
    return
  }
  assert.equal(input.timing.duration_ticks, project.timing.duration_ticks + 4)
  project = {
    ...project,
    revision: project.revision + 1,
    name: input.name,
    timing: input.timing,
    evaluation_contract: input.evaluation_contract,
    generation_rules: input.generation_rules,
  }
  await route.fulfill({ json: { workspace: workspace(), project } })
})

await page.goto(`${url}/projects/${ids.project}/edit`)
await page.getByRole("heading", { name: "Project grid authoring" }).waitFor()
assert.equal(await page.getByText("Verse · automatic", { exact: true }).count(), 1)
assert.equal(
  await page
    .getByLabel(/tick 8.*automatic region Verse/)
    .first()
    .getAttribute("aria-disabled"),
  "true",
)
if (evidenceDirectory !== undefined) {
  await mkdir(evidenceDirectory, { recursive: true })
  await page.screenshot({ path: `${evidenceDirectory}/project-grid-1280.png`, fullPage: true })
}
const existingRegion = page
  .locator(".project-region-form")
  .filter({ has: page.getByRole("heading", { name: "Verse", exact: true }) })
const regionName = existingRegion.getByRole("textbox", { name: "Region name", exact: true })
await regionName.fill("Unsaved region draft")
await page.getByRole("combobox", { name: "Quantize", exact: true }).selectOption("2")
assert.equal(await regionName.inputValue(), "Unsaved region draft")
await regionName.fill("Verse")
await page.getByLabel("Additional ticks").fill("4")
await page.getByRole("button", { name: "Add tail" }).click()
await page.getByText("Unsaved project draft", { exact: true }).waitFor()
await page.getByRole("button", { name: "Save project" }).click()
await page.getByText(/Your unsaved draft is still present/).waitFor()
await page.getByText("Unsaved project draft", { exact: true }).waitFor()
await page.getByRole("button", { name: "Save project" }).click()
await page.getByText("Saved revision 4", { exact: true }).waitFor()
await page.setViewportSize({ width: 768, height: 900 })
await page.locator(".project-grid-workspace").evaluate((element) => {
  element.scrollTop = 0
})
if (evidenceDirectory !== undefined)
  await page.screenshot({ path: `${evidenceDirectory}/project-grid-768.png`, fullPage: true })
await page.getByRole("button", { name: "Add region" }).scrollIntoViewIfNeeded()
assert.equal(await page.getByRole("button", { name: "Add region" }).isVisible(), true)
await page.setViewportSize({ width: 375, height: 812 })
await page.locator(".project-grid-workspace").evaluate((element) => {
  element.scrollTop = 0
})
const cue = page.getByText("Scroll sideways inside the timeline to reach all 10 lanes.")
const cueBox = await cue.boundingBox()
assert.ok(cueBox !== null && cueBox.y >= 0 && cueBox.y < 812)
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  ),
  true,
)
if (evidenceDirectory !== undefined)
  await page.screenshot({ path: `${evidenceDirectory}/project-grid-375.png`, fullPage: true })
await page.getByRole("button", { name: "Add region" }).scrollIntoViewIfNeeded()
assert.equal(await page.getByRole("button", { name: "Add region" }).isVisible(), true)
await page.getByLabel("Additional ticks").fill("1")
await page.getByRole("button", { name: "Add tail" }).click()
await page.getByRole("button", { name: "Back to projects" }).click()
await page.getByRole("alertdialog", { name: "Unsaved project draft" }).waitFor()
let leaveDialogs = 0
page.on("dialog", async (dialog) => {
  leaveDialogs += 1
  await dialog.accept()
})
await page.getByRole("button", { name: "Discard and leave" }).click()
await page.waitForURL(`${url}/`)
assert.equal(leaveDialogs, 0)
assert.deepEqual(
  errors.filter((message) => !message.includes("409 (Conflict)")),
  [],
)
await browser.close()
