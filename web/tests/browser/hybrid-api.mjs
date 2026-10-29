import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { chromium } from "playwright"

import { LibraryMutationSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import {
  automaticTiming,
  beatValue,
  projectBaseSources,
  savedChartBase,
  ZERO_BEAT,
} from "./project-beat-fixtures.mjs"
import { acceptedProjectAction, projectWorkspace } from "./projects-api-support.mjs"
import { restoreProjectUi } from "./projects-ui-support.mjs"
import { bootstrap, browserConfiguration } from "./ucs-support.mjs"

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
  const active = library.charts.find((chart) => chart.id === library.active_chart_id)
  assert.ok(active)
  const base = savedChartBase(
    await projectBaseSources(context, configuration.url, active.song_id),
    active.id,
  )
  assert.ok(base.timing.duration)
  const timing = automaticTiming(base)
  const region = {
    id: randomUUID(),
    name: "자동 후렴",
    rules: {
      start: { numerator: 4, denominator: 1 },
      end: base.timing.duration,
      step: { numerator: 1, denominator: 1 },
      pattern: [
        {
          choices: [
            { panel_mask: 4, hold: ZERO_BEAT, weight: 1 },
            { panel_mask: 8, hold: ZERO_BEAT, weight: 1 },
          ],
        },
      ],
    },
  }
  const created = await acceptedProjectAction(context, configuration.url, {
    type: "create_project",
    name: `Hybrid QA ${randomUUID().slice(0, 8)}`,
    song_id: active.song_id,
    mode: "Double",
    chart_artist: "Hybrid API Author",
    base_ucs_ref: base.ref,
    timing,
    evaluation_contract: before.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 2,
      algorithm: "hybrid_regions_v1",
      fixed_notes: [{ at: ZERO_BEAT, panel_mask: 1, hold: ZERO_BEAT }],
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
  assert.ok(first.chart.notes.some((note) => beatValue(note.at) === 0 && note.panel_mask === 1))
  const automatic = first.chart.notes.filter((note) => {
    const at = beatValue(note.at)
    return at >= 4 && at < beatValue(base.timing.duration)
  })
  assert.equal(automatic.length, 4)
  const written = await acceptedProjectAction(context, configuration.url, {
    type: "write_project",
    project_id: project.id,
    base_revision: project.revision,
    name: `${project.name} renamed`,
    chart_artist: project.chart_artist,
    timing: project.timing,
    evaluation_contract: project.evaluation_contract,
    generation_rules: {
      ...project.generation_rules,
      fixed_notes: [
        { at: ZERO_BEAT, panel_mask: 1, hold: ZERO_BEAT },
        {
          at: { numerator: 1, denominator: 2 },
          panel_mask: 2,
          hold: ZERO_BEAT,
        },
      ],
      regions: [{ ...region, name: "이름만 바꾼 후렴" }],
    },
  })
  assert.ok(written.project)
  project = written.project
  const second = await generate()
  assert.deepEqual(
    second.chart.notes.filter((note) => {
      const at = beatValue(note.at)
      return at >= 4 && at < beatValue(base.timing.duration)
    }),
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
