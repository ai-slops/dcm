import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { loadDemo } from "../../server/demo.ts"
import { createUcsSession, restoreUcsSession } from "./ucs-session.mjs"
import { bootstrap, browserConfiguration, ownedMutation, repoRoot } from "./ucs-support.mjs"

const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/fixed-editor")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
await page.addInitScript(() => {
  window.Audio = new Proxy(window.Audio, {
    construct(Target, args) {
      const audio = new Target(...args)
      window.__studioAudio = audio
      return audio
    },
  })
})
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const labels = ["L DL", "L UL", "L C", "L UR", "L DR", "R DL", "R UL", "R C", "R UR", "R DR"]
let session
let owned

function cell(tick, lane) {
  return page.getByRole("button", { name: new RegExp(`^${labels[lane]}, tick ${tick},`) })
}

async function save() {
  owned = await ownedMutation(page, "/api/v1/document", () =>
    page.getByRole("button", { name: "Save", exact: true }).click(),
  )
  return owned.project.chart.notes
}

async function drag(start, end, lane) {
  const head = await cell(start, lane).boundingBox()
  const tail = await cell(end, lane).boundingBox()
  assert.ok(head && tail)
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(tail.x + tail.width / 2, tail.y + tail.height / 2, { steps: 12 })
  await page.mouse.up()
}

try {
  const demo = await loadDemo(repoRoot)
  session = await createUcsSession(context, configuration.url, {
    mode: "Double",
    audio: demo.audio,
  })
  owned = session.document
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await cell(0, 0).click()
  assert.deepEqual(await save(), [{ tick: 0, panel_mask: 1, hold_ticks: 0 }])
  await cell(0, 0).click()
  assert.deepEqual(await save(), [])
  await drag(0, 4, 0)
  assert.deepEqual(await save(), [{ tick: 0, panel_mask: 1, hold_ticks: 4 }])
  await page.screenshot({ path: resolve(evidence, "dragged-hold.png") })
  await drag(6, 2, 0)
  await page
    .getByRole("alert")
    .filter({ hasText: /cell|overlap|occup|contains/i })
    .waitFor()
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  await cell(2, 0).click()
  assert.deepEqual(await save(), [])
  for (let lane = 0; lane < 10; lane += 1) await cell(0, lane).click()
  assert.deepEqual(await save(), [{ tick: 0, panel_mask: 1023, hold_ticks: 0 }])
  const colors = []
  for (let lane = 0; lane < 10; lane += 1)
    colors.push(await cell(0, lane).evaluate((node) => getComputedStyle(node).backgroundColor))
  assert.equal(colors[0], colors[4])
  assert.equal(colors[1], colors[3])
  assert.equal(new Set(colors.slice(0, 5)).size, 3)
  assert.deepEqual(colors.slice(0, 5), colors.slice(5))
  await page.screenshot({ path: resolve(evidence, "five-lane-note-colors.png") })
  await cell(0, 0).click()
  assert.deepEqual(await save(), [{ tick: 0, panel_mask: 1022, hold_ticks: 0 }])
  const scroller = page.locator(".timeline__scroller")
  const bounds = await scroller.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const beforeWheel = await scroller.evaluate((node) => node.scrollTop)
  await page.mouse.wheel(0, 1400)
  await page.waitForFunction(
    (previous) => document.querySelector(".timeline__scroller").scrollTop !== previous,
    beforeWheel,
  )
  const scrollBefore = await scroller.evaluate((node) => node.scrollTop)
  await page.getByRole("textbox", { name: "Base BPM", exact: true }).fill("138")
  await page.getByRole("button", { name: "Update marker", exact: true }).first().click()
  const scrollAfter = await scroller.evaluate((node) => node.scrollTop)
  assert.ok(
    Math.abs(scrollAfter - scrollBefore) < 2,
    "Tempo editing must preserve the visible scroll anchor",
  )
  await save()
  await page.screenshot({ path: resolve(evidence, "continuous-scroll-after-tempo-edit.png") })
  await page.getByRole("textbox", { name: "New marker tick", exact: true }).fill("96")
  await page.getByRole("textbox", { name: "New marker BPM", exact: true }).fill("180")
  await page.getByRole("button", { name: "Add marker", exact: true }).click()
  await save()
  await page.getByLabel("Chart position", { exact: true }).fill("0")
  await page.getByLabel("Follow audio", { exact: true }).check()
  await page.evaluate(() => {
    window.__followTrace = []
    window.__traceFollowing = true
    const record = () => {
      const playhead = document.querySelector('[data-testid="timeline-playhead"]')
      const viewport = document.querySelector(".timeline__scroller")
      if (playhead !== null && viewport !== null)
        window.__followTrace.push({
          time: window.__studioAudio.currentTime,
          position: playhead.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
        })
      if (window.__traceFollowing) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(() => window.__studioAudio.currentTime > 1.6)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  const trace = await page.evaluate(() => {
    window.__traceFollowing = false
    return window.__followTrace
  })
  const followed = trace.filter((sample) => sample.time > 0.3 && sample.time < 1.5)
  assert.ok(followed.length > 5)
  const positions = followed.map((sample) => sample.position)
  const followSpread = Math.max(...positions) - Math.min(...positions)
  assert.ok(
    followSpread < 136,
    "Audio following must not jump by viewport-sized pages at tempo boundaries",
  )
  await page.screenshot({ path: resolve(evidence, "follow-audio-tempo-boundary.png") })
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        click_toggle: true,
        drag_hold: true,
        collision_rejected_without_mutation: true,
        chord_peers_preserved: true,
        colors,
        scroll_before: scrollBefore,
        scroll_after: scrollAfter,
        follow_spread_pixels: followSpread,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    "PASS: click tap/delete, pointer hold, UCS-cell collision rejection, chord preservation, repeated lane colors and tempo-edit scroll continuity.",
  )
} finally {
  try {
    if (session !== undefined && owned !== undefined)
      await restoreUcsSession(context, configuration.url, { ...session, expected: owned })
  } finally {
    await browser.close()
  }
}
