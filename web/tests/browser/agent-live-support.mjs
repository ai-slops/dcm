import assert from "node:assert/strict"

import { AgentRunSnapshotSchema } from "../../shared/index.ts"
import { bootstrap, importProject } from "./ucs-support.mjs"

export async function observeAgentBrowser(page, origin) {
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
    if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(origin).origin)
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
  return {
    errors,
    consoleErrors,
    foreignRequests,
    get submissions() {
      return submissions
    },
  }
}

export async function verifyDecisionSerialization(page, ownerId, action) {
  await page.getByLabel("Agent instruction").fill("Read the saved chart.")
  assert.equal(await page.getByRole("button", { name: "Run task", exact: true }).isEnabled(), true)
  const pattern = `**/api/v1/agent/runs/${ownerId}`
  const paused = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const handled = Promise.withResolvers()
  const handler = async (route) => {
    entered.resolve()
    try {
      await paused.promise
      await route.continue()
    } finally {
      handled.resolve()
    }
  }
  await page.route(pattern, handler)
  try {
    await action()
    await entered.promise
    assert.equal(
      await page.getByRole("button", { name: "Run task", exact: true }).isDisabled(),
      true,
    )
    assert.equal(await page.getByLabel("Agent instruction").isDisabled(), true)
  } finally {
    paused.resolve()
    await handled.promise
    await page.unroute(pattern, handler)
  }
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Agent instruction"]').disabled,
  )
  await page.getByLabel("Agent instruction").fill("")
}

export async function restoreAgentDocument(context, url, baseline, audio, owned) {
  const current = await bootstrap(context, url)
  assert.deepEqual(current.document, owned, "Concurrent edit detected; refusing to overwrite it")
  const restored = await importProject(context, url, {
    csrfToken: current.csrf_token,
    revision: current.document.revision,
    project: baseline.project,
    audio,
  })
  assert.deepEqual(restored.project, baseline.project)
  const restoredAudio = await context.request.get(new URL("/api/v1/audio", url).toString())
  assert.equal(restoredAudio.status(), 200)
  assert.deepEqual(await restoredAudio.body(), audio)
}

export function agentBrowser(page, url) {
  return {
    async startTask(prompt) {
      await page.getByLabel("Agent instruction").fill(prompt)
      const pending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/agent/runs" &&
          response.request().method() === "POST",
      )
      await page.getByRole("button", { name: "Run task", exact: true }).click()
      const response = await pending
      assert.equal(response.status(), 202)
      const run = AgentRunSnapshotSchema.parse(await response.json())
      await page.getByText(`You: ${prompt}`, { exact: true }).waitFor()
      return run.id
    },
    async finishTask(id) {
      await page.waitForFunction(
        () =>
          /Run (completed|failed|cancelled)/.test(
            document.querySelector(".agent-run-status")?.textContent ?? "",
          ),
        undefined,
        { timeout: 150_000 },
      )
      const state = await bootstrap(page.context(), url)
      const run = state.recent_runs.find((item) => item.id === id)
      assert.ok(run, "Terminal run must remain recoverable")
      assert.equal(run.status, "completed", run.error?.message)
      assert.ok(run.text.length > 0)
      return { state, run }
    },
    proposalCard(proposal) {
      return page
        .locator("article.proposal")
        .filter({ has: page.getByText(proposal.summary, { exact: true }) })
        .filter({ has: page.getByRole("button", { name: "Apply changes", exact: true }) })
    },
  }
}
