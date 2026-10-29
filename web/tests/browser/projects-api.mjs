import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { chromium } from "playwright"

import { LibraryChartDocumentSchema } from "../../shared/library.ts"
import { librarySnapshot } from "./library-support.mjs"
import {
  automaticTiming,
  projectBaseSources,
  savedChartBase,
  weightedRules,
  ZERO_BEAT,
} from "./project-beat-fixtures.mjs"
import {
  acceptedProjectAction,
  cleanProjectArtifacts,
  projectAction,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { bootstrap, browserConfiguration } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_PROJECTS_QA,
  "1",
  "Set STUDIO_PROJECTS_QA=1 for temporary project mutations",
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
  const initial = await projectWorkspace(context, configuration.url)
  const library = await librarySnapshot(context, configuration.url)
  ids.selectedProjectId = initial.selected_project_id
  ids.activeChartId = library.active_chart_id
  const active = library.charts.find((chart) => chart.id === library.active_chart_id)
  assert.ok(active)
  const base = savedChartBase(
    await projectBaseSources(context, configuration.url, active.song_id),
    active.id,
  )
  assert.ok(base.timing.duration)
  const timing = automaticTiming(base)
  const name = `Rule project QA ${randomUUID().slice(0, 8)}`
  const fields = {
    name,
    timing,
    song_id: active.song_id,
    chart_artist: "Browser API Author",
    base_ucs_ref: base.ref,
    evaluation_contract: before.document.project.evaluation_contract,
    generation_rules: weightedRules({ end: base.timing.duration, panelMask: 1 }),
  }
  const missingMode = await projectAction(context, configuration.url, {
    type: "create_project",
    ...fields,
  })
  assert.equal(missingMode.status(), 400)
  const create = async (mode) => {
    const mutation = await acceptedProjectAction(context, configuration.url, {
      type: "create_project",
      ...fields,
      name: `${name} ${mode}`,
      mode,
    })
    assert.ok(mutation.project)
    ids.projectIds.push(mutation.project.id)
    return mutation.project
  }
  let single = await create("Single")
  let double = await create("Double")
  const write = async (project, rules) => {
    const mutation = await acceptedProjectAction(context, configuration.url, {
      type: "write_project",
      project_id: project.id,
      base_revision: project.revision,
      name: project.name,
      chart_artist: project.chart_artist,
      timing: project.timing,
      evaluation_contract: project.evaluation_contract,
      generation_rules: rules,
    })
    assert.ok(mutation.project)
    return mutation.project
  }
  const oldRevision = single.revision
  single = await write(single, {
    ...single.generation_rules,
    step: { numerator: 1, denominator: 2 },
  })
  const stale = await projectAction(context, configuration.url, {
    type: "write_project",
    project_id: single.id,
    base_revision: oldRevision,
    name: single.name,
    chart_artist: single.chart_artist,
    timing: single.timing,
    evaluation_contract: single.evaluation_contract,
    generation_rules: single.generation_rules,
  })
  assert.equal(stale.status(), 409)
  double = await write(double, {
    ...double.generation_rules,
    pattern: [{ choices: [{ panel_mask: 32, hold: ZERO_BEAT, weight: 1 }] }],
  })
  const publish = async (project) => {
    const mutation = await acceptedProjectAction(context, configuration.url, {
      type: "publish_component",
      project_id: project.id,
      base_revision: project.revision,
      kind: "generator",
      name: `${project.name} component`,
    })
    assert.ok(mutation.component)
    ids.componentIds.push(mutation.component.id)
    return mutation.component
  }
  const doubleComponent = await publish(double)
  const incompatible = await projectAction(context, configuration.url, {
    type: "apply_component",
    project_id: single.id,
    base_revision: single.revision,
    component_id: doubleComponent.id,
  })
  assert.ok(incompatible.status() >= 400 && incompatible.status() < 500)
  assert.equal(
    (await readRuleProject(context, configuration.url, single.id)).revision,
    single.revision,
  )
  const singleComponent = await publish(single)
  const applied = await acceptedProjectAction(context, configuration.url, {
    type: "apply_component",
    project_id: double.id,
    base_revision: double.revision,
    component_id: singleComponent.id,
  })
  assert.ok(applied.project)
  double = applied.project
  assert.equal(double.mode, "Double")
  assert.deepEqual(double.generation_rules, single.generation_rules)
  assert.equal(double.applied_components.generator.component_id, singleComponent.id)
  double = await write(double, {
    ...double.generation_rules,
    pattern: [{ choices: [{ panel_mask: 32, hold: ZERO_BEAT, weight: 1 }] }],
  })
  for (const project of [single, double]) {
    const mutation = await acceptedProjectAction(context, configuration.url, {
      type: "generate_project",
      project_id: project.id,
      base_revision: project.revision,
      name: `${project.name} output`,
      seed: "0".repeat(64),
    })
    assert.ok(mutation.generation)
    ids.chartIds.push(mutation.generation.chart_id)
    assert.equal(mutation.generation.mode, project.mode)
    assert.equal(mutation.generation.ucs_validation.valid, true)
    assert.equal(mutation.generation.certification.status, "none")
    assert.ok(mutation.generation.chart.notes.length > 0)
    const response = await context.request.get(
      new URL(
        `/api/v1/library/charts/${mutation.generation.chart_id}`,
        configuration.url,
      ).toString(),
    )
    assert.equal(response.status(), 200)
    const saved = LibraryChartDocumentSchema.parse(await response.json())
    assert.deepEqual(saved.project.notes, mutation.generation.chart.notes)
    assert.equal(saved.chart.mode, project.mode)
    assert.equal(saved.project.mode, project.mode)
    assert.ok(
      saved.project.notes.every((note) =>
        project.mode === "Single" ? note.panel_mask <= 31 : note.panel_mask === 32,
      ),
    )
  }
  assert.deepEqual(
    (await bootstrap(context, configuration.url)).document.project,
    before.document.project,
  )
  console.log(
    "PASS: required mode, project CAS read/write, reusable components and native Single/Double chart generation; active chart untouched.",
  )
} finally {
  try {
    if (ids.activeChartId !== undefined)
      await cleanProjectArtifacts(context, configuration.url, ids)
    if (before !== undefined)
      assert.deepEqual(
        (await bootstrap(context, configuration.url)).document.project,
        before.document.project,
      )
  } finally {
    await browser.close()
  }
}
