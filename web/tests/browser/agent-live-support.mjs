import assert from "node:assert/strict"

import { AgentRunSnapshotSchema } from "../../shared/index.ts"
import { bootstrap } from "./ucs-support.mjs"

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
