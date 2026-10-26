import assert from "node:assert/strict"

export async function verifyVisibleChrome(page) {
  const bounds = await page.evaluate(() => {
    const rectangles = [...document.querySelectorAll(".toolbar-actions > button, .transport")].map(
      (node) => {
        const rectangle = node.getBoundingClientRect()
        return {
          label: node.getAttribute("aria-label") ?? node.className,
          left: rectangle.left,
          right: rectangle.right,
        }
      },
    )
    const timeline = document.querySelector(".timeline")
    const timing = document.querySelector('[aria-label="Current timing context"]')
    const laneBounds = timeline.getBoundingClientRect()
    const timeBounds = timing.getBoundingClientRect()
    const visiblePads = [...document.querySelectorAll(".preview .pad")]
      .map((node) => node.getBoundingClientRect().width)
      .filter((width) => width > 0)
    return {
      width: innerWidth,
      minimumPadWidth: visiblePads.length === 0 ? null : Math.min(...visiblePads),
      rectangles,
      timeline: { left: laneBounds.left, right: laneBounds.right },
      timing: { left: timeBounds.left, right: timeBounds.right, width: timeBounds.width },
    }
  })
  for (const rectangle of bounds.rectangles) {
    assert.ok(
      rectangle.left >= 0 && rectangle.right <= bounds.width + 1,
      `${rectangle.label} is clipped at viewport ${bounds.width}`,
    )
  }
  if (bounds.timing.width > 0) {
    assert.ok(
      bounds.timing.left >= bounds.timeline.left &&
        bounds.timing.right <= bounds.timeline.right + 1,
      `Timing context is clipped at viewport ${bounds.width}`,
    )
  }
  if (bounds.minimumPadWidth !== null) {
    assert.ok(
      bounds.minimumPadWidth >= 24,
      `Preview pad labels are cramped at viewport ${bounds.width}`,
    )
  }
}
