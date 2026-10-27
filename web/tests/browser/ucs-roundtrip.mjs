import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { loadDemo } from "../../server/demo.ts"
import { StudioProjectV1Schema } from "../../shared/index.ts"
import { verifyVisibleChrome } from "./ucs-layout.mjs"
import { verifyAudioClock } from "./ucs-playback.mjs"
import { createUcsSession, openSingleFixture, restoreUcsSession } from "./ucs-session.mjs"
import {
  bootstrap,
  browserConfiguration,
  downloadUcs,
  evidenceRoot,
  extendDemoAudio,
  importProject,
  importUcsThroughUi,
  ownedMutation,
  repoRoot,
  SINGLE_UCS_FIXTURE,
  saveRecovery,
} from "./ucs-support.mjs"

const configuration = browserConfiguration()
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const pageErrors = []
const consoleErrors = []
page.on("pageerror", (error) => pageErrors.push(error.message))
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("422"))
    consoleErrors.push(message.text())
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
let baseline
let originalAudio
let owned
let session

try {
  baseline = await bootstrap(context, configuration.url)
  const audioResponse = await context.request.get(
    new URL("/api/v1/audio", configuration.url).toString(),
  )
  assert.equal(audioResponse.status(), 200)
  originalAudio = await audioResponse.body()
  console.log(
    `Private chart/audio recovery copy: ${saveRecovery(baseline.document.project, originalAudio)}`,
  )
  const demo = await loadDemo(repoRoot)
  const audio = extendDemoAudio(demo.audio)
  const fixture = StudioProjectV1Schema.parse({
    ...demo.document.project,
    title: "UCS browser regression",
    chart: {
      ticks_per_beat: 4,
      span_ticks: 192,
      notes: [
        { tick: 0, panel_mask: 544, hold_ticks: 0 },
        { tick: 0, panel_mask: 1, hold_ticks: 4 },
        { tick: 3, panel_mask: 16, hold_ticks: 2 },
        { tick: 8, panel_mask: 2, hold_ticks: 12 },
        { tick: 16, panel_mask: 4, hold_ticks: 4 },
        { tick: 24, panel_mask: 8, hold_ticks: 4 },
        { tick: 56, panel_mask: 16, hold_ticks: 8 },
      ],
    },
    music: {
      ...demo.document.project.music,
      duration_ticks: 192,
      offset_micros: 250_000,
      audio_sha256: [...createHash("sha256").update(audio).digest()],
    },
    audio_asset: { format: "wav", byte_length: audio.byteLength },
  })
  session = await createUcsSession(context, configuration.url, { mode: "Double", audio })
  owned = session.document
  owned = await importProject(context, configuration.url, {
    csrfToken: baseline.csrf_token,
    revision: owned.revision,
    project: fixture,
    audio,
  })
  const response = await page.goto(configuration.url)
  assert.equal(response.status(), 200)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByRole("button", { name: "R UR, tick 6, empty", exact: true }).click()
  owned = await ownedMutation(page, "/api/v1/document", () =>
    page.getByRole("button", { name: "Save", exact: true }).click(),
  )
  await page.reload()
  await page.getByRole("button", { name: "R UR, tick 6, tap", exact: true }).waitFor()

  const exported = resolve(evidenceRoot, "edited-chart.ucs")
  await downloadUcs(page, exported)
  const text = readFileSync(exported, "ascii")
  assert.ok(text.startsWith(":Format=1\r\n:Mode=Double\r\n"))
  assert.ok(text.includes(":Delay=250\r\n"))
  const parsed = spawnSync(
    resolve(repoRoot, "dist", process.platform === "win32" ? "pump.exe" : "pump"),
    ["chart", "import-ucs", exported, "--format", "json"],
    { encoding: "utf8" },
  )
  assert.equal(parsed.status, 0, parsed.stderr)
  const native = JSON.parse(parsed.stdout)
  assert.deepEqual(native.chart, owned.project.chart)
  assert.deepEqual(native.music.tempo, owned.project.music.tempo)
  assert.equal(native.music.offset_micros, 250_000)
  owned = await importUcsThroughUi(page, exported)
  await page.reload()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  assert.deepEqual(
    (await bootstrap(context, configuration.url)).document.project.chart,
    native.chart,
  )
  assert.equal((await bootstrap(context, configuration.url)).document.project.ucs_mode, "Double")
  assert.ok((await page.locator(".timeline__cell").count()) <= 480)

  await verifyAudioClock(page)

  await page.getByLabel("Audio offset", { exact: true }).fill("-1250")
  owned = await ownedMutation(page, "/api/v1/document", () =>
    page.getByRole("button", { name: "Save", exact: true }).click(),
  )
  const negative = resolve(evidenceRoot, "negative-offset.ucs")
  await downloadUcs(page, negative)
  assert.ok(readFileSync(negative, "ascii").includes(":Delay=-1.25\r\n"))
  owned = await importUcsThroughUi(page, negative)
  await page.reload()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  assert.equal(
    (await bootstrap(context, configuration.url)).document.project.music.offset_micros,
    -1250,
  )
  await page.getByLabel("Chart position", { exact: true }).fill("17")
  assert.ok(
    Math.abs((await page.evaluate(() => window.__studioAudio.currentTime)) - 2.09875) < 0.001,
  )
  await verifyVisibleChrome(page)
  await page.screenshot({ path: resolve(evidenceRoot, "desktop.png") })

  const modeChange = await context.request.put(
    new URL("/api/v1/document", configuration.url).toString(),
    {
      headers: { "x-csrf-token": baseline.csrf_token },
      data: {
        base_revision: owned.revision,
        project: {
          ...owned.project,
          chart: { ...owned.project.chart, notes: [] },
          ucs_mode: "Single",
        },
      },
    },
  )
  assert.equal(modeChange.status(), 409)
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  assert.equal(await page.getByRole("radio", { name: "Single", exact: true }).count(), 0)
  const malformed = resolve(evidenceRoot, "malformed.ucs")
  writeFileSync(malformed, ":Format=1\n:Mode=Double\n:UNSUPPORTED=1\n")
  await page.getByLabel("UCS chart", { exact: true }).setInputFiles(malformed)
  await page.getByRole("button", { name: "Import UCS", exact: true }).click()
  await page
    .getByRole("alert")
    .filter({ hasText: /UCS .*unsupported|UCS .*directive/i })
    .waitFor()
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  await page.screenshot({ path: resolve(evidenceRoot, "ucs-error.png") })
  await page.getByRole("button", { name: "Close", exact: true }).click()
  const single = resolve(evidenceRoot, "single.ucs")
  writeFileSync(single, SINGLE_UCS_FIXTURE)
  owned = await openSingleFixture(context, configuration.url, session.songId)
  await page.reload()
  owned = await importUcsThroughUi(page, single)
  assert.equal(owned.project.ucs_mode, "Single")
  assert.ok(owned.project.chart.notes.every((note) => (note.panel_mask & ~31) === 0))
  const singleExport = resolve(evidenceRoot, "single-export.ucs")
  await downloadUcs(page, singleExport, "Single")
  assert.ok(readFileSync(singleExport, "ascii").startsWith(":Format=1\r\n:Mode=Single\r\n"))
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByLabel("Chart position", { exact: true }).fill("5")
  assert.ok(Math.abs((await page.evaluate(() => window.__studioAudio.currentTime)) - 0.725) < 0.001)
  assert.equal(await page.locator('.pad--right[data-active="true"]').count(), 0)
  await page.screenshot({ path: resolve(evidenceRoot, "single-desktop.png") })
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 375) {
      await verifyVisibleChrome(page)
      await page.screenshot({ path: resolve(evidenceRoot, "375-editor.png") })
      await page.getByRole("tab", { name: "preview", exact: true }).click()
    }
    await verifyVisibleChrome(page)
    await page.screenshot({ path: resolve(evidenceRoot, `${width}.png`) })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
  }
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.screenshot({ path: resolve(evidenceRoot, "375-dialog.png") })
  await page.getByRole("button", { name: "Close", exact: true }).click()
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])
  console.log(
    "PASS: real HTTPS UCS edit/export/native parse/import, tempo/hold/offset/media-clock alignment, playback controls, bounded follow window, reload persistence, useful errors, and responsive UI.",
  )
} finally {
  try {
    if (owned !== undefined && session !== undefined)
      await restoreUcsSession(context, configuration.url, { ...session, expected: owned })
  } finally {
    await browser.close()
  }
}
