import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { agentBrowser, observeAgentBrowser } from "./agent-live-support.mjs"
import { librarySnapshot } from "./library-support.mjs"
import {
  automaticTiming,
  projectBaseSources,
  savedChartBase,
  weightedRules,
} from "./project-beat-fixtures.mjs"
import {
  acceptedProjectAction,
  cleanProjectArtifacts,
  projectWorkspace,
  readRuleProject,
} from "./projects-api-support.mjs"
import { bootstrap, browserConfiguration, repoRoot } from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_LIVE_AGENT,
  "1",
  "Set STUDIO_LIVE_AGENT=1 to verify actual model-backed project writes",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/project-agent")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const observed = await observeAgentBrowser(page, configuration.url)
const agent = agentBrowser(page, configuration.url)
const ids = {
  projectIds: [],
  componentIds: [],
  chartIds: [],
  selectedProjectId: null,
  activeChartId: undefined,
}
let before
let runId

try {
  before = await bootstrap(context, configuration.url)
  assert.equal(before.agent.configured, true)
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
  const created = await acceptedProjectAction(context, configuration.url, {
    type: "create_project",
    name: `Agent rules QA ${randomUUID().slice(0, 8)}`,
    song_id: active.song_id,
    mode: "Single",
    chart_artist: "Live Agent Author",
    base_ucs_ref: base.ref,
    timing,
    evaluation_contract: before.document.project.evaluation_contract,
    generation_rules: weightedRules({ end: base.timing.duration, panelMask: 1 }),
  })
  assert.ok(created.project)
  const project = created.project
  ids.projectIds.push(project.id)
  await acceptedProjectAction(context, configuration.url, {
    type: "select_project",
    project_id: project.id,
  })
  await page.goto(configuration.url)
  await page.getByLabel("Allow project and library writes", { exact: true }).check()
  runId = await agent.startTask(
    `Use list_songs to discover the real available background songs and read_chart to inspect existing chart ${ids.activeChartId} without editing it. Use read_project to read project ${project.id}. Then use write_project exactly once to change only generation_rules.step from beat 1/1 to beat 1/2, preserving its name, chart artist, timing, evaluation contract, and all other rules. Supply the actual base revision from read_project. Read the same project again with read_project to verify the persisted change. Do not create or generate charts, proposals, components, or other projects. Do not edit the active chart document. Finish with a brief result naming the saved project revision.`,
  )
  const completed = await agent.finishTask(runId)
  const saved = await readRuleProject(context, configuration.url, project.id)
  assert.equal(saved.revision, project.revision + 1)
  assert.deepEqual(saved.generation_rules.step, { numerator: 1, denominator: 2 })
  assert.equal(saved.mode, "Single")
  assert.equal(saved.song_id, project.song_id)
  assert.deepEqual(saved.timing, project.timing)
  assert.deepEqual(saved.evaluation_contract, project.evaluation_contract)
  assert.deepEqual(saved.generation_rules, {
    ...project.generation_rules,
    step: { numerator: 1, denominator: 2 },
  })
  const tools = completed.run.tool_calls ?? []
  for (const toolId of ["list_songs", "read_chart"])
    assert.ok(tools.some((tool) => tool.tool_id === toolId && tool.state === "completed"))
  assert.equal(
    tools.filter((tool) => tool.tool_id === "write_project" && tool.state === "completed").length,
    1,
  )
  assert.ok(
    tools.filter((tool) => tool.tool_id === "read_project" && tool.state === "completed").length >=
      2,
  )
  assert.deepEqual(completed.state.document.project, before.document.project)
  assert.deepEqual(observed.errors, [])
  assert.deepEqual(observed.consoleErrors, [])
  assert.deepEqual(observed.foreignRequests, [])
  await page.locator(".run-result").scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "persisted-project-write.png") })
  const receipt = {
    status: completed.run.status,
    model: completed.run.model,
    api: completed.run.api,
    project_id: project.id,
    saved_revision: saved.revision,
    saved_step: saved.generation_rules.step,
    tools: tools.map((tool) => ({ tool: tool.tool_id, state: tool.state })),
    active_chart_preserved: true,
    foreign_requests: observed.foreignRequests.length,
  }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(receipt))
} finally {
  try {
    if (runId !== undefined) {
      const current = await bootstrap(context, configuration.url)
      if (current.active_run?.id === runId) {
        const response = await context.request.delete(
          new URL(`/api/v1/agent/runs/${runId}`, configuration.url).toString(),
          { headers: { "x-csrf-token": current.csrf_token } },
        )
        assert.equal(response.status(), 200)
      }
    }
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
