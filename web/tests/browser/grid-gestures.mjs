import assert from "node:assert/strict"

const lanes = ["L DL", "L UL", "L C", "L UR", "L DR", "R DL", "R UL", "R C", "R UR", "R DR"]

export function gridCell(page, tick, lane) {
  return page.getByRole("button", { name: new RegExp(`^${lanes[lane]}, tick ${tick},`) })
}

export async function dragGridHold(page, gesture) {
  const head = await gridCell(page, gesture.start, gesture.lane).boundingBox()
  const tail = await gridCell(page, gesture.end, gesture.lane).boundingBox()
  assert.ok(head && tail)
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(tail.x + tail.width / 2, tail.y + tail.height / 2, { steps: 12 })
  await page.mouse.up()
}

export async function waitForGalleryTimeline(page) {
  await page.waitForFunction(() => {
    const wrapper = document.querySelector(".preview-gallery__timeline")
    const scroller = wrapper?.querySelector(".timeline__scroller")
    if (
      wrapper === null ||
      scroller === null ||
      scroller === undefined ||
      scroller.clientHeight <= 0
    )
      return false
    const outer = wrapper.getBoundingClientRect()
    const viewport = scroller.getBoundingClientRect()
    return [...scroller.querySelectorAll(".timeline__row")].some((row) => {
      const rect = row.getBoundingClientRect()
      return (
        rect.bottom > Math.max(outer.top, viewport.top) &&
        rect.top < Math.min(outer.bottom, viewport.bottom)
      )
    })
  })
}
