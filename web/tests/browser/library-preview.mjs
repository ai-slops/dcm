import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"
import { LibraryChartDocumentSchema } from "../../shared/library.ts"
import { tickToAudioMicros } from "../../src/domain/timing.ts"
import { waitForGalleryTimeline } from "./grid-gestures.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

const chartId = process.env.STUDIO_LIBRARY_CHART_ID
assert.ok(chartId, "Set STUDIO_LIBRARY_CHART_ID to a stored chart with real music")
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/library-preview")
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

try {
  const before = await bootstrap(context, configuration.url)
  const response = await context.request.get(
    new URL(`/api/v1/library/charts/${chartId}`, configuration.url).toString(),
  )
  assert.equal(response.status(), 200)
  const stored = LibraryChartDocumentSchema.parse(await response.json())
  await page.goto(new URL(`/previews?chart=${chartId}`, configuration.url).toString())
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByRole("button", { name: "First note", exact: true }).click()
  const first = stored.project.chart.notes[0]
  assert.ok(first)
  const firstSeconds = tickToAudioMicros(stored.project.music, first.tick) / 1_000_000
  await page.waitForFunction(
    (seconds) => Math.abs(window.__studioAudio.currentTime - seconds) < 0.05,
    firstSeconds,
  )
  assert.equal(await page.evaluate(() => window.__studioAudio.paused), true)
  await page.screenshot({ path: resolve(evidence, "first-note.png") })
  const startedAt = await page.evaluate(() => window.__studioAudio.currentTime)
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(
    (seconds) => window.__studioAudio.currentTime > seconds + 0.5,
    startedAt,
  )
  await page.screenshot({ path: resolve(evidence, "playing.png") })
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  const hold = stored.project.chart.notes.find((note) => note.hold_ticks > 0)
  assert.ok(hold)
  await page.getByLabel("Chart position", { exact: true }).fill(String(hold.tick))
  await page
    .getByRole("img", { name: /hold, tick/ })
    .first()
    .waitFor()
  await page.screenshot({ path: resolve(evidence, "hold.png") })
  const captures = []
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const view of ["player", "pads", "timeline", "transport", "primitives"]) {
      await page.getByRole("button", { name: view, exact: true }).click()
      if (view === "timeline") await waitForGalleryTimeline(page)
      await page
        .getByRole("button", { name: view, exact: true })
        .getAttribute("aria-pressed")
        .then((value) => assert.equal(value, "true"))
      await page.mouse.move(0, 0)
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished),
        )
      })
      const name = `${width}-${view}.png`
      await page.screenshot({ path: resolve(evidence, name), fullPage: true })
      captures.push(name)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${view} overflowed at ${width}px`,
      )
      const clipped = await page.locator(".transport").evaluate((transport) => {
        const bounds = transport.getBoundingClientRect()
        return [...transport.querySelectorAll("button,input,select")]
          .filter((control) => {
            const rect = control.getBoundingClientRect()
            return (
              rect.width === 0 ||
              rect.height === 0 ||
              rect.left < bounds.left - 1 ||
              rect.right > bounds.right + 1 ||
              rect.top < bounds.top - 1 ||
              rect.bottom > bounds.bottom + 1
            )
          })
          .map((control) => control.getAttribute("aria-label") ?? control.textContent)
      })
      assert.deepEqual(clipped, [], `Transport controls clipped in ${width}-${view}`)
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(
    (await bootstrap(context, configuration.url)).document.project,
    before.document.project,
  )
  const media = await page.evaluate(() => ({
    duration: window.__studioAudio.duration,
    muted: window.__studioAudio.muted,
    volume: window.__studioAudio.volume,
  }))
  assert.equal(media.muted, false)
  assert.ok(media.volume > 0)
  const result = {
    chart_id: chartId,
    first_note_seconds: firstSeconds,
    music_duration_seconds: media.duration,
    actual_playback: true,
    holds_visible: true,
    active_project_preserved: true,
    captures,
  }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
