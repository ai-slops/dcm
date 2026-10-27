import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { unzipSync } from "fflate"

import {
  chooseSong,
  closeLibrary,
  libraryMutation,
  librarySnapshot,
  openLibrary,
  savedChartRow,
  songSection,
} from "./library-support.mjs"
import {
  captureLibraryBaseline,
  createLibraryWorkflowSession,
  restoreLibraryWorkflow,
} from "./library-workflow-session.mjs"

const session = await createLibraryWorkflowSession()
const { configuration, evidence, context, page, errors } = session

const suffix = randomUUID().slice(0, 8)
const originalTitle = `Library regression ${suffix}`
const renamedTitle = `검증용 곡 이름 ${suffix}`
const doubleName = `Double ${suffix}`
const singleName = `Single ${suffix}`
const duplicateName = `${doubleName} copy`
const renamedDuplicate = `Duplicate renamed ${suffix}`
let state
let temporarySongId

try {
  state = await captureLibraryBaseline(session)
  const { initialSongIds, initialChartIds, fixtureAudio, fixtureHash, fixturePath } = state

  const response = await page.goto(configuration.url)
  assert.equal(response.status(), 200)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await openLibrary(page)
  await page.screenshot({ path: resolve(evidence, "desktop-library.png") })

  const create = page.getByRole("region", { name: "Create song", exact: true })
  await create.getByLabel("Song title", { exact: true }).fill(originalTitle)
  await create.getByLabel("Artist", { exact: true }).fill("임시 검증용 아티스트")
  await create.getByLabel("First chart name", { exact: true }).fill(doubleName)
  await create.locator("select").selectOption("Double")
  await create.getByLabel("BPM", { exact: true }).fill("138")
  await create.getByLabel("Beats", { exact: true }).fill("128")
  const created = await libraryMutation(page, "/api/v1/library/songs", () =>
    create.getByRole("button", { name: "Create song", exact: true }).click(),
  )
  const temporarySong = created.library.songs.find((song) => !initialSongIds.has(song.id))
  assert.ok(temporarySong)
  temporarySongId = temporarySong.id
  assert.equal(temporarySong.title, originalTitle)
  assert.equal(
    created.library.charts.some(
      (chart) =>
        chart.song_id === temporarySong.id && chart.name === doubleName && chart.mode === "Double",
    ),
    true,
  )

  await chooseSong(page, originalTitle)
  await songSection(page).getByLabel("New chart name", { exact: true }).fill(singleName)
  await songSection(page).getByLabel("New chart mode", { exact: true }).selectOption("Single")
  const withSingle = await libraryMutation(page, "/api/v1/library/actions", () =>
    songSection(page).getByRole("button", { name: "New chart", exact: true }).click(),
  )
  const doubleChart = withSingle.library.charts.find(
    (chart) => chart.song_id === temporarySong.id && chart.name === doubleName,
  )
  const singleChart = withSingle.library.charts.find(
    (chart) => chart.song_id === temporarySong.id && chart.name === singleName,
  )
  assert.ok(doubleChart)
  assert.ok(singleChart)
  assert.equal(singleChart.mode, "Single")

  const duplicated = await libraryMutation(page, "/api/v1/library/actions", () =>
    savedChartRow(page, doubleName).getByRole("button", { name: "Duplicate", exact: true }).click(),
  )
  const duplicate = duplicated.library.charts.find(
    (chart) => chart.song_id === temporarySong.id && chart.name === duplicateName,
  )
  assert.ok(duplicate)
  const duplicateRow = page.locator(`[data-chart-id="${duplicate.id}"]`)
  await duplicateRow.getByLabel(`Rename ${duplicateName}`, { exact: true }).fill(renamedDuplicate)
  const renamed = await libraryMutation(page, "/api/v1/library/actions", () =>
    duplicateRow.getByRole("button", { name: "Rename", exact: true }).click(),
  )
  assert.equal(
    renamed.library.charts.some((chart) => chart.name === renamedDuplicate),
    true,
  )
  const renamedRow = page.locator(`[data-chart-id="${duplicate.id}"]`)
  await renamedRow.getByRole("button", { name: "Delete", exact: true }).click()
  const afterDelete = await libraryMutation(page, "/api/v1/library/actions", () =>
    page
      .getByRole("alertdialog", { name: "Confirm deletion", exact: true })
      .getByRole("button", { name: "Delete", exact: true })
      .click(),
  )
  assert.equal(
    afterDelete.library.charts.some((chart) => chart.id === duplicate.id),
    false,
  )

  await songSection(page).getByLabel("Title", { exact: true }).fill(renamedTitle)
  const renamedSong = await libraryMutation(page, "/api/v1/library/actions", () =>
    songSection(page).getByRole("button", { name: "Rename song", exact: true }).click(),
  )
  assert.equal(
    renamedSong.library.songs.find((song) => song.id === temporarySong.id)?.title,
    renamedTitle,
  )

  await closeLibrary(page)
  const emptyCell = page.getByRole("button", { name: /empty$/ }).first()
  await emptyCell.click()
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), true)
  await openLibrary(page)
  await chooseSong(page, renamedTitle)
  await savedChartRow(page, doubleName).getByRole("button", { name: "Open", exact: true }).click()
  const guard = page.getByRole("alertdialog", { name: "Unsaved changes", exact: true })
  await guard.waitFor()
  await page.screenshot({ path: resolve(evidence, "dirty-save-and-switch.png") })
  const savedResponse = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === "/api/v1/document" && item.request().method() === "PUT",
  )
  const switchedResponse = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === "/api/v1/library/actions" &&
      item.request().method() === "POST",
  )
  await guard.getByRole("button", { name: "Save and continue", exact: true }).click()
  assert.equal((await savedResponse).status(), 200)
  assert.equal((await switchedResponse).status(), 200)
  await page.getByText("Updating library complete", { exact: true }).waitFor()

  const replacedPending = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === `/api/v1/library/songs/${temporarySong.id}/audio` &&
      item.request().method() === "PUT",
  )
  await songSection(page)
    .getByLabel("Replace song audio", { exact: true })
    .setInputFiles(fixturePath)
  const replacedResponse = await replacedPending
  assert.equal(replacedResponse.status(), 200, await replacedResponse.text())
  const replacedLibrary = await librarySnapshot(context, configuration.url)
  const replacedSong = replacedLibrary.songs.find((song) => song.id === temporarySong.id)
  assert.ok(replacedSong)
  assert.equal(replacedSong.audio.sha256, fixtureHash)
  assert.equal(replacedSong.audio.byte_length, fixtureAudio.byteLength)

  await closeLibrary(page)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  const startedAt = await page.evaluate(() => window.__studioAudio.currentTime)
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(
    (time) => window.__studioAudio.currentTime > time + 0.2 && !window.__studioAudio.paused,
    startedAt,
  )
  await page.getByRole("button", { name: "Pause", exact: true }).click()

  await openLibrary(page)
  await chooseSong(page, renamedTitle)
  const downloadPending = page.waitForEvent("download")
  await songSection(page)
    .getByRole("button", { name: "Download saved song ZIP", exact: true })
    .click()
  const download = await downloadPending
  assert.equal(await download.failure(), null)
  const zipPath = resolve(evidence, "temporary-song.zip")
  await download.saveAs(zipPath)
  const zipEntries = Object.keys(unzipSync(readFileSync(zipPath)))
  assert.equal(zipEntries.filter((name) => name.toLowerCase().endsWith(".ucs")).length, 2)
  assert.equal(
    zipEntries.some((name) => /\.(wav|ogg|mp3)$/i.test(name)),
    true,
  )

  await closeLibrary(page)
  await page.reload()
  await page.getByText("Audio ready", { exact: true }).waitFor()
  const reloadedLibrary = await librarySnapshot(context, configuration.url)
  assert.equal(
    reloadedLibrary.songs.some((song) => song.id === temporarySong.id),
    true,
  )
  assert.equal(
    reloadedLibrary.charts.filter((chart) => chart.song_id === temporarySong.id).length,
    2,
  )
  await page.setViewportSize({ width: 375, height: 900 })
  await openLibrary(page)
  await chooseSong(page, renamedTitle)
  await page.screenshot({ path: resolve(evidence, "375-library.png") })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)

  for (const id of initialSongIds) {
    assert.equal(
      reloadedLibrary.songs.some((song) => song.id === id),
      true,
    )
  }
  for (const id of initialChartIds) {
    assert.equal(
      reloadedLibrary.charts.some((chart) => chart.id === id),
      true,
    )
  }
  assert.deepEqual(errors, [])
  const resultSummary = {
    temporary_song: renamedTitle,
    charts_created: [doubleName, singleName],
    duplicate_renamed_deleted: true,
    dirty_save_and_switch: true,
    audio_replaced_and_played: true,
    zip_entries: zipEntries.length,
    reload_persisted: true,
  }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(resultSummary, null, 2), {
    mode: 0o600,
  })
  console.log(JSON.stringify(resultSummary))
} finally {
  await restoreLibraryWorkflow(session, state, temporarySongId)
}
