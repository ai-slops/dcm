import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { chromium } from "playwright"

import { loadDemo } from "../../server/demo.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import { acceptedProjectAction, projectWorkspace } from "./projects-api-support.mjs"
import { restoreProjectUi } from "./projects-ui-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for temporary hybrid projects",
)
const configuration = browserConfiguration()
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const ids = {
  projectIds: [],
  componentIds: [],
  chartIds: [],
  selectedProjectId: null,
  activeChartId: undefined,
}
let before

try {
  before = await bootstrap(context, configuration.url)
  const workspace = await projectWorkspace(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  ids.activeChartId = library.active_chart_id
  ids.selectedProjectId = workspace.selected_project_id
  const song = library.songs[0]
  assert.ok(song)
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audio, ...timing } = demo.document.project.music
  const region = {
    id: randomUUID(),
    name: "자동 후렴",
    rules: {
      start_tick: 8,
      end_tick: 24,
      step_ticks: 4,
      pattern: [
        {
          choices: [
            { panel_mask: 4, hold_ticks: 0, weight: 1 },
            { panel_mask: 8, hold_ticks: 0, weight: 1 },
          ],
        },
      ],
    },
  }
  const created = await acceptedProjectAction(context, configuration.url, {
    type: "create_project",
    name: `Hybrid QA ${randomUUID().slice(0, 8)}`,
    song_id: song.id,
    mode: "Double",
    timing,
    evaluation_contract: demo.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [{ tick: 0, panel_mask: 1, hold_ticks: 0 }],
      regions: [region],
    },
  })
  assert.ok(created.project)
  let project = created.project
  ids.projectIds.push(project.id)
  const generate = async () => {
    const mutation = await acceptedProjectAction(context, configuration.url, {
      type: "generate_project",
      project_id: project.id,
      base_revision: project.revision,
      name: "Hybrid result",
      seed: "0".repeat(64),
    })
    assert.ok(mutation.generation)
    ids.chartIds.push(mutation.generation.chart_id)
    return mutation.generation
  }
  const first = await generate()
  assert.ok(first.chart.notes.some((note) => note.tick === 0 && note.panel_mask === 1))
  const automatic = first.chart.notes.filter((note) => note.tick >= 8 && note.tick < 24)
  assert.equal(automatic.length, 4)
  const written = await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: `${project.name} renamed`,
    timing: project.timing,
    evaluation_contract: project.evaluation_contract,
    generation_rules: {
      ...project.generation_rules,
      fixed_notes: [
        { tick: 0, panel_mask: 1, hold_ticks: 0 },
        { tick: 2, panel_mask: 2, hold_ticks: 0 },
      ],
      regions: [{ ...region, name: "이름만 바꾼 후렴" }],
    },
  })
  assert.ok(written.project)
  project = written.project
  const second = await generate()
  assert.deepEqual(
    second.chart.notes.filter((note) => note.tick >= 8 && note.tick < 24),
    automatic,
  )
  const current = await bootstrap(context, configuration.url)
  const latestLibrary = await librarySnapshot(context, configuration.url)
  const opened = await context.request.post(
    new URL("/api/v1/library/actions", configuration.url).toString(),
    {
      headers: { "x-csrf-token": current.csrf_token },
      data: {
        type: "open_chart",
        library_revision: latestLibrary.revision,
        base_revision: current.document.revision,
        chart_id: first.chart_id,
      },
    },
  )
  assert.equal(opened.status(), 200)
  const result = LibraryMutationSchema.parse(await opened.json())
  assert.equal(result.document.origin.automatic_regions[0].name, "자동 후렴")
  assert.equal(result.document.origin.project_revision, 0)
  assert.deepEqual(
    (await bootstrap(context, configuration.url)).document.origin,
    result.document.origin,
  )
  console.log(
    "PASS: fixed+named-auto native generation, stable region sampling after unrelated edits, and immutable result-region origin.",
  )
} finally {
  try {
    if (ids.activeChartId !== undefined) await restoreProjectUi(context, configuration.url, ids)
    if (before !== undefined)
      assert.deepEqual(
        (await bootstrap(context, configuration.url)).document.project,
        before.document.project,
      )
  } finally {
    await browser.close()
  }
}
