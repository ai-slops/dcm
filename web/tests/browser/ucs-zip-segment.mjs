import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { strToU8, zipSync } from "fflate"
import { chromium } from "playwright"

import { loadDemo } from "../../server/demo.ts"
import {
  bootstrap,
  browserConfiguration,
  extendDemoAudio,
  importProject,
  ownedMutation,
  repoRoot,
  SINGLE_UCS_FIXTURE,
  saveRecovery,
} from "./ucs-support.mjs"

const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/ucs-zip-segment")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
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
let baseline
let originalAudio
let owned

async function chooseSegment(start, end, loop = false) {
  await page.getByRole("button", { name: "Segment", exact: true }).click()
  await page.getByLabel("Segment start in audio seconds").fill(String(start))
  await page.getByLabel("Segment end in audio seconds").fill(String(end))
  await page.getByLabel("Loop selected segment").setChecked(loop)
  await page.getByRole("button", { name: "Play segment", exact: true }).click()
}

async function watchLoop(start, end) {
  await page.evaluate(() => {
    window.__loopSeeks = []
    window.__studioAudio.addEventListener("seeked", () =>
      window.__loopSeeks.push(window.__studioAudio.currentTime),
    )
  })
  await chooseSegment(start, end, true)
  await page.waitForFunction(
    (start) =>
      window.__loopSeeks.filter((value) => value >= start && value < start + 0.1).length >= 3,
    start,
  )
  const media = await page.evaluate(() => ({
    time: window.__studioAudio.currentTime,
    loop: window.__studioAudio.loop,
    paused: window.__studioAudio.paused,
  }))
  assert.equal(media.loop, false)
  assert.equal(media.paused, false)
  assert.ok(media.time >= start && media.time <= end + 0.05)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
}

try {
  baseline = await bootstrap(context, configuration.url)
  const response = await context.request.get(new URL("/api/v1/audio", configuration.url).toString())
  originalAudio = await response.body()
  saveRecovery(baseline.document.project, originalAudio)
  const demo = await loadDemo(repoRoot)
  const audio = extendDemoAudio(demo.audio)
  const single = resolve(evidence, "single-song.zip")
  const multiple = resolve(evidence, "multiple-charts.zip")
  const invalid = resolve(evidence, "missing-music.zip")
  writeFileSync(
    single,
    zipSync({ "곡/Single.ucs": strToU8(SINGLE_UCS_FIXTURE), "곡/music.wav": audio }),
  )
  writeFileSync(
    multiple,
    zipSync({
      "곡/Easy.ucs": strToU8(SINGLE_UCS_FIXTURE),
      "곡/Hard.ucs": strToU8(SINGLE_UCS_FIXTURE.replace("M.X..", "M..X.")),
      "곡/music.wav": audio,
      "곡/preview.wav": demo.audio,
    }),
  )
  writeFileSync(invalid, zipSync({ "chart.ucs": strToU8(SINGLE_UCS_FIXTURE) }))
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByLabel("UCS song ZIP", { exact: true }).setInputFiles(single)
  await page.getByRole("button", { name: "Import selected ZIP files", exact: true }).waitFor()
  owned = await ownedMutation(page, "/api/v1/ucs/import", () =>
    page.getByRole("button", { name: "Import selected ZIP files", exact: true }).click(),
  )
  assert.deepEqual(owned.project.music.audio_sha256, [
    ...createHash("sha256").update(audio).digest(),
  ])
  await page.getByText("Audio ready", { exact: true }).waitFor()

  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByLabel("UCS song ZIP", { exact: true }).setInputFiles(multiple)
  await page.getByLabel("Chart from ZIP", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("Chart from ZIP", { exact: true }).inputValue(), "")
  assert.equal(await page.getByLabel("Music from ZIP", { exact: true }).inputValue(), "")
  assert.equal(
    await page.getByRole("button", { name: "Import selected ZIP files", exact: true }).isDisabled(),
    true,
  )
  await page.getByLabel("Chart from ZIP", { exact: true }).selectOption("곡/Hard.ucs")
  await page.getByLabel("Music from ZIP", { exact: true }).selectOption("곡/music.wav")
  await page.screenshot({ path: resolve(evidence, "zip-choices.png") })
  owned = await ownedMutation(page, "/api/v1/ucs/import", () =>
    page.getByRole("button", { name: "Import selected ZIP files", exact: true }).click(),
  )
  assert.ok(owned.project.chart.notes.some((note) => note.tick === 0 && note.panel_mask === 8))
  assert.equal(owned.project.music.offset_micros, 125_000)
  await page.getByText("Audio ready", { exact: true }).waitFor()

  await chooseSegment(0.75, 1.25)
  await page.waitForFunction(
    () => window.__studioAudio.paused && Math.abs(window.__studioAudio.currentTime - 1.25) < 0.001,
  )
  assert.equal(
    await page.getByRole("button", { name: "Segment", exact: true }).getAttribute("aria-pressed"),
    "true",
  )
  await page.screenshot({ path: resolve(evidence, "segment-paused.png") })
  await watchLoop(0.5, 0.8)
  const duration = await page.evaluate(() => window.__studioAudio.duration)
  await watchLoop(duration - 0.25, duration)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  assert.equal(
    await page.getByRole("button", { name: "Segment", exact: true }).getAttribute("aria-pressed"),
    "false",
  )

  const before = await page.evaluate(() => window.__studioAudio.currentTime)
  await chooseSegment(2, 1)
  await page.getByRole("dialog", { name: "Play audio segment" }).getByRole("alert").waitFor()
  assert.equal(await page.evaluate(() => window.__studioAudio.currentTime), before)
  await page.screenshot({ path: resolve(evidence, "invalid-range.png") })
  await page.getByRole("button", { name: "Close", exact: true }).click()

  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 1200) await page.getByRole("tab", { name: "preview", exact: true }).click()
    await page.getByRole("button", { name: "Segment", exact: true }).click()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-segment.png`) })
    await page.getByRole("button", { name: "Close", exact: true }).click()
  }
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByLabel("UCS song ZIP", { exact: true }).setInputFiles(invalid)
  await page
    .getByRole("dialog", { name: "UCS transfer" })
    .getByRole("alert")
    .filter({ hasText: "does not contain" })
    .waitFor()
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  await page.screenshot({ path: resolve(evidence, "375-zip-error.png") })
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.reload()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  assert.equal(
    await page.getByRole("button", { name: "Segment", exact: true }).getAttribute("aria-pressed"),
    "false",
  )
  assert.deepEqual(errors, [])
  console.log(
    "PASS: HTTPS ZIP chart/music selection, atomic audio import, segment end pause, interval looping, end-of-media looping, invalid range, mobile preview and reload reset.",
  )
} finally {
  try {
    if (owned !== undefined) {
      const current = await bootstrap(context, configuration.url)
      assert.deepEqual(
        current.document,
        owned,
        "Concurrent edits detected; refusing to overwrite the saved project",
      )
      await importProject(context, configuration.url, {
        csrfToken: current.csrf_token,
        revision: current.document.revision,
        project: baseline.document.project,
        audio: originalAudio,
      })
      console.log("Original project and audio restored; only monotonic revision advanced.")
    }
  } finally {
    await browser.close()
  }
}
