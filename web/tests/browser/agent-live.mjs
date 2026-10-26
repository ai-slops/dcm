import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "playwright"

import { agentBrowser } from "./agent-live-support.mjs"
import {
  bootstrap,
  browserConfiguration,
  importProject,
  ownedMutation,
  repoRoot,
  saveRecovery,
} from "./ucs-support.mjs"

assert.equal(
  process.env.STUDIO_LIVE_AGENT,
  "1",
  "Set STUDIO_LIVE_AGENT=1 to use the real model and briefly edit the saved chart",
)
const configuration = browserConfiguration()
const evidence = resolve(repoRoot, "web/artifacts/agent")
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const browser = await chromium.launch(configuration.launch)
const context = await browser.newContext(configuration.context)
const page = await context.newPage()
const { startTask, finishTask, proposalCard } = agentBrowser(page, configuration.url)
const errors = []
const consoleErrors = []
const foreignRequests = []
let submissions = 0
page.on("pageerror", (error) => errors.push(error.message))
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text())
})
page.on("request", (request) => {
  const url = new URL(request.url())
  if (
    ["http:", "https:"].includes(url.protocol) &&
    url.origin !== new URL(configuration.url).origin
  )
    foreignRequests.push(url.origin)
  if (url.pathname === "/api/v1/agent/runs" && request.method() === "POST") submissions += 1
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
let baseline
let audio
let owned
const receipt = { inspection: null, review: null, cancellation: null, viewports: [] }

try {
  baseline = await bootstrap(context, configuration.url)
  assert.equal(baseline.agent.source, "dim")
  assert.equal(baseline.agent.configured, true)
  assert.ok(baseline.agent.model, "Configure a tool-capable catalog model before the smoke")
  const audioResponse = await context.request.get(
    new URL("/api/v1/audio", configuration.url).toString(),
  )
  assert.equal(audioResponse.status(), 200)
  audio = await audioResponse.body()
  saveRecovery(baseline.document.project, audio)
  await page.goto(configuration.url)
  await page.getByText("Audio ready", { exact: true }).waitFor()
  await page.getByLabel("Chart position", { exact: true }).fill("1")
  const originalSeek = await page.evaluate(() => window.__studioAudio.currentTime)

  const inspectionId = await startTask(
    "Read the saved document with read_document, run evaluate_chart, and run validate_ucs in Double mode. Do not propose changes. Summarize the actual tool results briefly; do not show private reasoning.",
  )
  await page.reload()
  const inspection = await finishTask(inspectionId)
  assert.deepEqual(inspection.state.document, baseline.document)
  for (const tool of ["read_document", "evaluate_chart", "validate_ucs"])
    assert.ok(
      inspection.run.tool_calls.some((call) => call.tool_id === tool && call.state === "completed"),
    )
  assert.equal(submissions, 1, "Refresh must not resubmit the model task")
  receipt.inspection = {
    status: inspection.run.status,
    model: inspection.run.model,
    api: inspection.run.api,
    tools: inspection.run.tool_calls.map((call) => ({ tool: call.tool_id, state: call.state })),
    text_characters: inspection.run.text.length,
  }
  await page.locator(".run-result").scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "inspection.png") })

  const reviewId = await startTask(
    "Read the saved project. Using propose_chart, create exactly THREE review-only proposals, in this order, with distinct concise summaries: first keep the chart unchanged and increase music.offset_micros by 1000; second remove ONLY the last entry of chart.notes if any and increase the original music.offset_micros by 2000; third keep the original chart unchanged and increase the original music.offset_micros by 3000. For each proposal supply the COMPLETE music object preserving all other fields, especially audio_sha256 and tempo, and preserve the chart profile. Do not apply anything. Finish with a brief summary.",
  )
  const review = await finishTask(reviewId)
  assert.deepEqual(
    review.state.document,
    baseline.document,
    "Model proposals must not mutate the document",
  )
  const proposals = review.state.proposals.filter((proposal) => proposal.run_id === reviewId)
  assert.equal(proposals.length, 3)
  const proposalAt = (delta) =>
    proposals.find(
      (proposal) =>
        proposal.music?.offset_micros === baseline.document.project.music.offset_micros + delta,
    )
  const rejected = proposalAt(1000)
  const applied = proposalAt(2000)
  const stale = proposalAt(3000)
  assert.ok(rejected && applied && stale)
  assert.deepEqual(applied.chart.notes, baseline.document.project.chart.notes.slice(0, -1))
  await page.reload()
  await proposalCard(rejected).waitFor()
  await proposalCard(applied).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, "proposals.png") })

  await proposalCard(rejected).getByRole("button", { name: "Reject", exact: true }).click()
  await page
    .getByRole("region", { name: "Proposal decision history" })
    .getByText("Rejected", { exact: true })
    .first()
    .waitFor()
  assert.deepEqual((await bootstrap(context, configuration.url)).document, baseline.document)
  owned = await ownedMutation(page, `/api/v1/proposals/${applied.id}/apply`, () =>
    proposalCard(applied).getByRole("button", { name: "Apply changes", exact: true }).click(),
  )
  assert.deepEqual(owned.project.chart, applied.chart)
  assert.deepEqual(owned.project.music, applied.music)
  assert.equal(
    await page.getByLabel("Audio offset", { exact: true }).inputValue(),
    String(applied.music.offset_micros),
  )
  await page.getByLabel("Chart position", { exact: true }).fill("2")
  await page.getByLabel("Chart position", { exact: true }).fill("1")
  const changedSeek = await page.evaluate(() => window.__studioAudio.currentTime)
  assert.ok(
    Math.abs(changedSeek - originalSeek - 0.002) < 0.000_01,
    "Applied timing must reach the media clock",
  )
  assert.equal(
    await proposalCard(stale)
      .getByRole("button", { name: "Apply changes", exact: true })
      .isDisabled(),
    true,
  )
  const conflict = await context.request.post(
    new URL(`/api/v1/proposals/${stale.id}/apply`, configuration.url).toString(),
    {
      headers: { "x-csrf-token": baseline.csrf_token },
      data: { base_revision: baseline.document.revision },
    },
  )
  assert.equal(conflict.status(), 409)
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  await proposalCard(stale).getByRole("button", { name: "Reject", exact: true }).click()
  await page.reload()
  await page.getByRole("region", { name: "Proposal decision history" }).waitFor()
  const decided = (await bootstrap(context, configuration.url)).recent_runs.find(
    (run) => run.id === reviewId,
  )
  assert.equal(
    decided.proposal_decisions.filter((decision) => decision.status === "applied").length,
    1,
  )
  assert.equal(
    decided.proposal_decisions.filter((decision) => decision.status === "rejected").length,
    2,
  )
  receipt.review = {
    status: decided.status,
    proposed: 3,
    applied: 1,
    rejected: 2,
    stale_http_status: conflict.status(),
    media_clock_delta_seconds: changedSeek - originalSeek,
  }
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 1200) await page.getByRole("tab", { name: "agent", exact: true }).click()
    await page.getByLabel("Agent instruction").scrollIntoViewIfNeeded()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: resolve(evidence, `${width}-agent.png`) })
    await page.getByRole("region", { name: "Proposal decision history" }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(evidence, `${width}-decisions.png`) })
    receipt.viewports.push(width)
  }

  const cancelledId = await startTask(
    "Read the saved chart with read_document, then write a detailed 5000-word explanation of possible future chart analysis. Do not propose or apply anything.",
  )
  await page.locator(".tool-call--completed").first().waitFor({ timeout: 90_000 })
  await page.getByRole("button", { name: "Cancel run", exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector(".agent-run-status")?.textContent.includes("Run cancelled"),
  )
  await page.reload()
  await page.getByRole("tab", { name: "agent", exact: true }).click()
  const cancelled = (await bootstrap(context, configuration.url)).recent_runs.find(
    (run) => run.id === cancelledId,
  )
  assert.equal(cancelled.status, "cancelled")
  assert.deepEqual((await bootstrap(context, configuration.url)).document, owned)
  receipt.cancellation = { status: cancelled.status, recovered_after_refresh: true }
  await page.screenshot({ path: resolve(evidence, "cancelled.png") })
  assert.deepEqual(errors, [])
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(foreignRequests, [], "The browser must never contact the private model router")
  writeFileSync(resolve(evidence, "live-evidence.json"), JSON.stringify(receipt, null, 2), {
    mode: 0o600,
  })
  console.log(JSON.stringify(receipt))
} finally {
  try {
    if (owned !== undefined) {
      const current = await bootstrap(context, configuration.url)
      assert.deepEqual(
        current.document,
        owned,
        "Concurrent edit detected; refusing to overwrite it",
      )
      await importProject(context, configuration.url, {
        csrfToken: current.csrf_token,
        revision: current.document.revision,
        project: baseline.document.project,
        audio,
      })
    }
  } finally {
    await browser.close()
  }
}
