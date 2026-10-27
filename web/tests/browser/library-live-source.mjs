import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"

import { chromium } from "playwright"

import { LibraryChartDocumentSchema } from "../../shared/library.ts"
import {
  closeLibrary,
  libraryMutation,
  librarySnapshot,
  openLibrary,
  songSection,
} from "./library-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_LIVE_LIBRARY,
  "1",
  "Set STUDIO_LIVE_LIBRARY=1 for real public song downloads",
)
const reference = process.env.STUDIO_SAMPLE_UCS_FILE
assert.ok(reference, "Set STUDIO_SAMPLE_UCS_FILE to an untracked example UCS file")
const expected = spawnSync(
  resolve(repoRoot, "dist/pump"),
  ["chart", "import-ucs", reference, "--format", "json"],
  { encoding: "utf8" },
)
assert.equal(expected.status, 0, expected.stderr)
const native = JSON.parse(expected.stdout)
const label = basename(reference).replace(/\.ucs$/i, "")
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/library-live-source")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
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
let before
let originalId

try {
  before = await bootstrap(context, configuration.url)
  const initial = await librarySnapshot(context, configuration.url)
  originalId = initial.active_chart_id
  await page.goto(configuration.url)
  await openLibrary(page)
  const archives = page.getByRole("region", { name: "Original archives", exact: true })
  await archives.getByLabel("Search public songs", { exact: true }).fill("CS839")
  const searched = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/library/catalog",
  )
  await archives.getByRole("button", { name: "Search Pump Pro", exact: true }).click()
  assert.equal((await searched).status(), 200)
  const result = archives
    .getByRole("list", { name: "Public Pump Pro UCS results", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "CS839" })
  await result.getByText("Nemonemo", { exact: true }).waitFor()
  const oldIds = new Set(initial.archives.map((archive) => archive.id))
  const downloaded = await libraryMutation(page, "/api/v1/library/archives/download", () =>
    result.getByRole("button", { name: "Download", exact: true }).click(),
  )
  const archive =
    downloaded.library.archives.find((item) => !oldIds.has(item.id)) ??
    downloaded.library.archives.find((item) => item.title === "Nemonemo")
  assert.ok(archive)
  assert.equal(archive.byte_length, 994_182)
  assert.equal(archive.sha256, "2827c1649be740462d09b733465692681996f7ebb70d43697bfe57fb6782f3c5")
  const row = archives.locator(`[data-archive-id="${archive.id}"]`)
  await row
    .getByRole("button")
    .filter({ has: page.getByText(archive.name, { exact: true }) })
    .click()
  await page.screenshot({ path: resolve(evidence, "source-download.png") })
  const existingSongs = new Set(downloaded.library.songs.map((song) => song.id))
  const imported = await libraryMutation(page, "/api/v1/library/actions", () =>
    archives.getByRole("button", { name: "Import as song", exact: true }).click(),
  )
  const song = imported.library.songs.find((item) => !existingSongs.has(item.id))
  assert.ok(song)
  assert.equal(song.audio.format, "mp3")
  assert.equal(song.audio.byte_length, 1_012_608)
  assert.equal(
    song.audio.sha256,
    "1af73a2e8637f2ec3ff1e2d85c0de03cd19489533de9fe6d0df7cdc8116a0b60",
  )
  await page.locator(`[data-song-id="${song.id}"]`).click()
  await songSection(page).getByLabel("Imported chart name", { exact: true }).fill(label)
  await songSection(page).getByLabel("UCS file", { exact: true }).setInputFiles(reference)
  const withReference = await libraryMutation(page, `/api/v1/library/songs/${song.id}/charts`, () =>
    songSection(page).getByRole("button", { name: "Import chart", exact: true }).click(),
  )
  const chart = withReference.library.charts.find(
    (item) => item.song_id === song.id && item.name === label,
  )
  assert.ok(chart)
  const source = await context.request.get(
    new URL(`/api/v1/library/charts/${chart.id}`, configuration.url).toString(),
  )
  const document = LibraryChartDocumentSchema.parse(await source.json())
  assert.deepEqual(document.project.chart, native.chart)
  assert.deepEqual(document.project.music.tempo, native.music.tempo)
  assert.equal(document.project.music.offset_micros, native.music.offset_micros)
  assert.deepEqual(
    (await bootstrap(context, configuration.url)).document.project,
    before.document.project,
  )
  await closeLibrary(page)
  const previewUrl = new URL(`/previews?chart=${chart.id}`, configuration.url).toString()
  await page.goto(previewUrl)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  const media = await page.evaluate(() => ({
    duration: window.__studioAudio.duration,
    muted: window.__studioAudio.muted,
    volume: window.__studioAudio.volume,
  }))
  assert.ok(media.duration > 100, "Preview must use real package music, not the short editor demo")
  assert.equal(media.muted, false)
  assert.ok(media.volume > 0)
  const first = native.chart.notes[0]
  assert.ok(first)
  await page.getByLabel("Chart position", { exact: true }).fill(String(first.tick))
  await page
    .getByRole("region", { name: "Scrolling 10-lane Double chart preview", exact: true })
    .waitFor()
  const startedAt = await page.evaluate(() => window.__studioAudio.currentTime)
  await page.screenshot({ path: resolve(evidence, "reference-first-note.png") })
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await page.waitForFunction(
    (time) => window.__studioAudio.currentTime > time + 0.5 && !window.__studioAudio.paused,
    startedAt,
  )
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  for (const view of ["player", "pads", "timeline", "transport", "primitives"]) {
    await page.getByRole("button", { name: view, exact: true }).click()
    await page.screenshot({ path: resolve(evidence, `component-${view}.png`) })
  }
  await page.getByRole("button", { name: "player", exact: true }).click()
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-preview.png`) })
  }
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        preview_url: previewUrl,
        song_id: song.id,
        chart_id: chart.id,
        notes: native.chart.notes.length,
        duration_seconds: media.duration,
        audio_sha256: song.audio.sha256,
        downloaded_bytes: archive.byte_length,
        actual_playback: true,
        active_project_preserved: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(
    JSON.stringify({
      preview_url: previewUrl,
      chart_groups: native.chart.notes.length,
      music_duration_seconds: media.duration,
      actual_playback: true,
    }),
  )
} finally {
  try {
    if (originalId !== undefined) {
      const current = await bootstrap(context, configuration.url)
      const library = await librarySnapshot(context, configuration.url)
      if (library.active_chart_id !== originalId) {
        const restored = await context.request.post(
          new URL("/api/v1/library/actions", configuration.url).toString(),
          {
            headers: { "x-csrf-token": current.csrf_token },
            data: {
              type: "open_chart",
              library_revision: library.revision,
              base_revision: current.document.revision,
              chart_id: originalId,
            },
          },
        )
        assert.equal(restored.status(), 200)
      }
      assert.deepEqual(
        (await bootstrap(context, configuration.url)).document.project,
        before.document.project,
      )
    }
  } finally {
    await browser.close()
  }
}
