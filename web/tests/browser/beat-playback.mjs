import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

const configuration = browserConfiguration()
const directory = resolve(repoRoot, "web/artifacts/beat-root")
mkdirSync(directory, { recursive: true, mode: 0o700 })
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
try {
  const before = await bootstrap(context, configuration.url)
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByLabel("Chart beat position", { exact: true }).fill("8")
  await page.getByLabel("Follow audio", { exact: true }).check()
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(
    () => window.__studioAudio !== undefined && !window.__studioAudio.paused,
  )
  const metrics = await page.evaluate(async () => {
    const values = []
    for (let index = 0; index < 90; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const line = document.querySelector(".timeline__playhead")
      const header = document.querySelector(".timeline__header")
      const row = document.querySelector(".timeline__row")
      const scroller = document.querySelector(".timeline__scroller")
      if (line === null || header === null || row === null || scroller === null)
        throw new Error("Timeline geometry missing")
      values.push({
        y: line.getBoundingClientRect().top,
        expected: header.getBoundingClientRect().bottom + row.getBoundingClientRect().height,
        scroll: scroller.scrollTop,
        seconds: window.__studioAudio.currentTime,
      })
    }
    return values
  })
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  assert.ok(metrics.at(-1).seconds > metrics[0].seconds)
  assert.ok(metrics.at(-1).scroll > metrics[0].scroll)
  const spread =
    Math.max(...metrics.map((value) => value.y)) - Math.min(...metrics.map((value) => value.y))
  assert.ok(spread < 1.1, `Judgment line moved by ${spread}px`)
  const rowError = Math.max(...metrics.map((value) => Math.abs(value.y - value.expected)))
  assert.ok(rowError < 2, `Judgment line is not one row below the header: ${rowError}px`)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(directory, `${width}-root.png`), fullPage: true })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual((await bootstrap(context, configuration.url)).document, before.document)
  const result = {
    actual_audio_advanced: true,
    notes_scrolled: true,
    fixed_judgment_spread_px: spread,
    one_row_anchor_error_px: rowError,
    persisted_document_unchanged: true,
  }
  writeFileSync(resolve(directory, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(
    "PASS: real audio scrolls notes beneath a fixed one-row judgment line without saving changes.",
  )
} finally {
  await browser.close()
}
