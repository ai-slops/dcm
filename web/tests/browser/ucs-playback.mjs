import assert from "node:assert/strict"

export async function verifyAudioClock(page) {
  for (const quantize of [2, 4, 8]) {
    await page.getByLabel(/^Quantize/).selectOption(String(quantize))
    for (const label of [
      "R UR, tick 6, tap",
      "L DR, tick 3, hold-head",
      "L DR, tick 4, hold-body",
      "L DR, tick 5, hold-tail",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).waitFor()
    }
    assert.equal(await page.locator(".timeline__cell").count(), 480)
  }
  await page.getByLabel(/^Quantize/).selectOption("1")
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.getByTestId("preview-time").filter({ hasText: "PRE-ROLL" }).waitFor()
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="preview-time"]').textContent.replace("TICK ", ""),
      ) > 2,
  )
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByLabel("Chart position", { exact: true }).fill("17")
  await page.waitForFunction(
    () => document.querySelector('[data-testid="preview-time"]').textContent === "TICK 17.00",
  )
  const clock = await page.evaluate(() => ({
    time: window.__studioAudio.currentTime,
    duration: window.__studioAudio.duration,
  }))
  assert.ok(Math.abs(clock.time - 2.35) < 0.001)
  assert.ok(Math.abs(clock.duration - 24) < 0.001)
  assert.match(await page.locator(".preview__summary").innerText(), /L UL.*L C/)
  assert.match(await page.getByLabel("Current timing context").innerText(), /150(?:\.00)? BPM/)
  await page.getByLabel(/^Speed/).selectOption("0.75")
  await page.getByLabel("Volume", { exact: true }).fill("0.5")
  await page.getByLabel("Loop", { exact: true }).check()
  assert.deepEqual(
    await page.evaluate(() => [
      window.__studioAudio.playbackRate,
      window.__studioAudio.volume,
      window.__studioAudio.loop,
    ]),
    [0.75, 0.5, true],
  )
  await page.getByLabel("Loop", { exact: true }).uncheck()
  await page.getByLabel("Chart position", { exact: true }).fill("20")
  await page.waitForFunction(
    () => document.querySelector(".preview__summary").textContent === "No active contacts",
  )
  await page.getByLabel("Chart position", { exact: true }).fill("35")
  await page.waitForFunction(() => {
    const line = document
      .querySelector('[data-testid="timeline-playhead"]')
      ?.getBoundingClientRect()
    const scroller = document.querySelector(".timeline__scroller")?.getBoundingClientRect()
    return (
      line !== undefined &&
      scroller !== undefined &&
      line.top >= scroller.top &&
      line.bottom <= scroller.bottom + 1
    )
  })
  await page.getByLabel("Chart position", { exact: true }).fill("47.6")
  await page.getByLabel("Go to tick", { exact: true }).fill("0")
  await page.getByLabel("Follow audio", { exact: true }).check()
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.getByRole("button", { name: "L DL, tick 48, empty", exact: true }).waitFor()
  assert.equal(await page.getByLabel("Go to tick", { exact: true }).inputValue(), "0")
  assert.equal(await page.locator(".timeline__cell").count(), 480)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
}
