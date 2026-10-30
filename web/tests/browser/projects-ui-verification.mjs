import assert from "node:assert/strict"
import { resolve } from "node:path"

export async function verifyResponsiveProjectGrid(page, evidence) {
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
}
