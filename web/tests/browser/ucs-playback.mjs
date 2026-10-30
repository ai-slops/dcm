import assert from "node:assert/strict"

export async function verifyBoundedTimeline(page, lanes = 10) {
  const rows = await page.locator(".timeline__row").count()
  assert.ok(rows <= 2_080, `Visible timeline rendered ${rows} rows`)
  assert.ok((await page.locator(".timeline__cell").count()) <= rows * lanes)
}

export async function verifyAudioClock(page) {
  const exactHold = page.locator(
    '.timeline__exact-note[data-beat-numerator="3"][data-beat-denominator="4"][data-lane="4"]',
  )
  for (const split of [2, 4, 8]) {
    await page.getByLabel("Split rows per beat", { exact: true }).fill(String(split))
    await exactHold.waitFor()
    assert.match(await exactHold.getAttribute("aria-label"), /hold tail 5\/4/)
    await verifyBoundedTimeline(page)
  }
  await page.getByLabel("Split rows per beat", { exact: true }).fill("1")
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.getByTestId("transport-beat").filter({ hasText: "PRE-ROLL" }).waitFor()
  await page.waitForFunction(() => window.__studioAudio.currentTime > 0.3)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByLabel("Chart beat position", { exact: true }).fill("4.25")
  await page.getByLabel("Current timing context").filter({ hasText: "Beat 4.25" }).waitFor()
  const clock = await page.evaluate(() => ({
    time: window.__studioAudio.currentTime,
    duration: window.__studioAudio.duration,
  }))
  assert.ok(Math.abs(clock.time - 2.35) < 0.001)
  assert.ok(Math.abs(clock.duration - 24) < 0.001)
  assert.match(await page.getByLabel("Current timing context").innerText(), /150 BPM/)
  assert.match(await page.getByLabel("Current timing context").innerText(), /Offset \+250 ms/)
  await page.locator(".note-list summary").click()
  assert.match(await page.locator(".note-list").innerText(), /Beat 3\/4, mask 16, hold 1\/2/)
  await page.locator(".note-list summary").click()
  await page.getByRole("combobox", { name: "Playback speed", exact: true }).selectOption("0.75")
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
  await page.getByLabel("Chart beat position", { exact: true }).fill("13.5")
  await page
    .locator(
      '.timeline__exact-note[data-beat-numerator="14"][data-beat-denominator="1"][data-lane="4"]',
    )
    .waitFor()
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
  assert.equal(await page.getByLabel("Go to tick", { exact: true }).count(), 0)
  assert.equal(await page.getByLabel("Follow audio", { exact: true }).count(), 0)
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(() => window.__studioAudio.currentTime > 6.7)
  await verifyBoundedTimeline(page)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
}
