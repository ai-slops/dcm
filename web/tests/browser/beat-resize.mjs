import assert from "node:assert/strict"

import { chromium } from "playwright"

import { browserConfiguration } from "./ucs-support.mjs"

const configuration = browserConfiguration()
const browser = await chromium.launch(configuration.launch)
const page = await browser.newPage(configuration.context)
try {
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("Follow audio", { exact: true }).count(), 0)
  const originalScrollTop = await page
    .locator(".timeline__scroller")
    .evaluate((element) => element.scrollTop)
  await page.locator(".timeline__scroller").hover()
  await page.mouse.wheel(0, 500)
  await page.waitForFunction(
    (original) => Math.abs(document.querySelector(".timeline__scroller").scrollTop - original) > 1,
    originalScrollTop,
  )
  const visibleBeat = () =>
    page.evaluate(() => {
      const header = document.querySelector(".timeline__header").getBoundingClientRect()
      const row = [...document.querySelectorAll(".timeline__row")].find(
        (element) => element.getBoundingClientRect().bottom > header.bottom + 1,
      )
      const cell = row.querySelector(".timeline__cell")
      return Number(cell.dataset.beatNumerator) / Number(cell.dataset.beatDenominator)
    })
  const initial = await visibleBeat()
  const shifts = []
  for (const width of [1280, 768, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    shifts.push(Math.abs((await visibleBeat()) - initial))
  }
  assert.ok(
    shifts.every((shift) => shift < 1),
    `Resize lost the beat anchor: shifts=${shifts.join(",")}`,
  )
  console.log("PASS: responsive row-height changes preserve the visible beat anchor.")
} finally {
  await browser.close()
}
