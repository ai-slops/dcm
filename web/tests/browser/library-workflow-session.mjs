import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { LibraryMutationSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

export async function createLibraryWorkflowSession() {
  const configuration = browserConfiguration()
  const evidence = resolve(repoRoot, "web/artifacts/library-workflows")
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
  return { configuration, evidence, browser, context, page, errors }
}

export async function captureLibraryBaseline(session) {
  const baseline = await bootstrap(session.context, session.configuration.url)
  const initialLibrary = await librarySnapshot(session.context, session.configuration.url)
  const initialSongIds = new Set(initialLibrary.songs.map((song) => song.id))
  const initialChartIds = new Set(initialLibrary.charts.map((chart) => chart.id))
  const activeChart = initialLibrary.charts.find(
    (chart) => chart.id === initialLibrary.active_chart_id,
  )
  assert.ok(activeChart)
  const activeSong = initialLibrary.songs.find((song) => song.id === activeChart.song_id)
  assert.ok(activeSong)
  const audioResponse = await session.context.request.get(
    new URL(`/api/v1/library/songs/${activeSong.id}/audio`, session.configuration.url).toString(),
  )
  assert.equal(audioResponse.status(), 200)
  const fixtureAudio = await audioResponse.body()
  const fixtureHash = createHash("sha256").update(fixtureAudio).digest("hex")
  const fixturePath = resolve(session.evidence, `active-audio.${activeSong.audio.format}`)
  writeFileSync(fixturePath, fixtureAudio, { mode: 0o600 })
  return {
    baseline,
    initialLibrary,
    initialSongIds,
    initialChartIds,
    fixtureAudio,
    fixtureHash,
    fixturePath,
  }
}

async function postCommand(session, csrfToken, command) {
  const response = await session.context.request.post(
    new URL("/api/v1/library/actions", session.configuration.url).toString(),
    { headers: { "x-csrf-token": csrfToken }, data: command },
  )
  assert.equal(response.status(), 200, await response.text())
  return LibraryMutationSchema.parse(await response.json())
}

export async function restoreLibraryWorkflow(session, state, temporarySongId) {
  try {
    if (state === undefined) return
    let currentBootstrap = await bootstrap(session.context, session.configuration.url)
    let currentLibrary = await librarySnapshot(session.context, session.configuration.url)
    for (const song of state.initialLibrary.songs) {
      assert.equal(
        currentLibrary.songs.some((candidate) => candidate.id === song.id),
        true,
        `Pre-existing song ${song.id} disappeared`,
      )
    }
    if (currentLibrary.active_chart_id !== state.initialLibrary.active_chart_id) {
      const restored = await postCommand(session, currentBootstrap.csrf_token, {
        type: "open_chart",
        library_revision: currentLibrary.revision,
        base_revision: currentBootstrap.document.revision,
        chart_id: state.initialLibrary.active_chart_id,
      })
      currentLibrary = restored.library
      currentBootstrap = await bootstrap(session.context, session.configuration.url)
    }
    if (
      temporarySongId !== undefined &&
      currentLibrary.songs.some((song) => song.id === temporarySongId)
    ) {
      const deleted = await postCommand(session, currentBootstrap.csrf_token, {
        type: "delete_song",
        library_revision: currentLibrary.revision,
        song_id: temporarySongId,
      })
      currentLibrary = deleted.library
    }
    assert.equal(currentLibrary.active_chart_id, state.initialLibrary.active_chart_id)
    assert.deepEqual(currentLibrary.songs, state.initialLibrary.songs)
    assert.deepEqual(currentLibrary.charts, state.initialLibrary.charts)
    assert.deepEqual(currentLibrary.archives, state.initialLibrary.archives)
    assert.deepEqual(
      (await bootstrap(session.context, session.configuration.url)).document.project,
      state.baseline.document.project,
    )
    const restoredAudio = await session.context.request.get(
      new URL("/api/v1/audio", session.configuration.url).toString(),
    )
    assert.equal(restoredAudio.status(), 200)
    assert.deepEqual(await restoredAudio.body(), state.fixtureAudio)
    console.log(
      "Original active chart, audio, and catalog restored; temporary song removed; compatibility metadata preserved.",
    )
  } finally {
    await session.browser.close()
  }
}
