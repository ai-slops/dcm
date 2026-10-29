import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ok } from "@slop-lab/part/contracts/index.js"
import { afterEach, expect, it } from "vitest"

import { AgentRuns } from "../../server/agent/runs.ts"
import { loadDemo } from "../../server/demo.ts"
import { nativeDocumentFor } from "../../server/native/beat-document.ts"
import { SessionStore } from "../../server/sessions.ts"
import { StudioStore } from "../../server/store.ts"
import { MAX_SESSION_PROPOSALS } from "../../shared/api.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "pump-proposal-bounds-"))
  roots.push(root)
  const demo = await loadDemo(repoRoot)
  const store = await StudioStore.open(root, demo.document, demo.audio)
  const session = new SessionStore().create()
  const runs = new AgentRuns({
    configuration: { endpoint: new URL("http://127.0.0.1:1"), model: "fixture" },
    store,
    native: {
      evaluate: () => Promise.reject(new TypeError("Unexpected evaluation")),
      generate: () => Promise.reject(new TypeError("Unexpected generation")),
    },
    createRuntime: (options) =>
      ok({
        async start() {
          for (let index = 0; index < 4; index += 1)
            await options.proposeChart(
              { chart: nativeDocumentFor(options.project).chart, summary: `Proposal ${index}` },
              options.signal,
            )
          return ok({
            done: Promise.resolve({ phase: "completed" as const, text: "Proposals ready" }),
            async *observe() {
              yield { text: "Proposals ready" }
            },
            cancel: async () => undefined,
          })
        },
        dispose: async () => undefined,
      }),
  })
  return {
    runs,
    session,
    store,
    async run() {
      const started = runs.start(session, store.document(), "Propose")
      const record = runs.get(session, started.id)
      await record.settled()
      return record.snapshot
    },
  }
}

it("gives each run its own proposal allowance on an unchanged revision", async () => {
  const fixture = await harness()
  expect((await fixture.run()).status).toBe("completed")
  expect((await fixture.run()).status).toBe("completed")
  expect(fixture.session.proposals.size).toBe(8)
})

it("caps all pending session proposals across saved revisions", async () => {
  const fixture = await harness()
  for (let index = 0; index < MAX_SESSION_PROPOSALS / 4; index += 1) {
    expect((await fixture.run()).status).toBe("completed")
    const current = fixture.store.document()
    await fixture.store.save(current.revision, current.project)
  }
  expect((await fixture.run()).status).toBe("failed")
  expect(fixture.session.proposals.size).toBe(MAX_SESSION_PROPOSALS)
})

it("recovers a session snapshot after other sessions evict its live runtime record", async () => {
  const fixture = await harness()
  const first = await fixture.run()
  for (let index = 0; index < 260; index += 1) {
    const session = new SessionStore().create()
    const run = fixture.runs.start(session, fixture.store.document(), "Propose")
    await fixture.runs.get(session, run.id).settled()
  }
  expect(() => fixture.runs.get(fixture.session, first.id)).toThrow()
  expect(fixture.runs.snapshot(fixture.session, first.id).status).toBe("completed")
  expect(() => fixture.runs.snapshot(new SessionStore().create(), first.id)).toThrow()
})

it("pins pending proposal owners while later same-session runs fill history", async () => {
  const fixture = await harness()
  const first = await fixture.run()
  const proposal = [...fixture.session.proposals.values()][0]
  if (proposal === undefined) throw new TypeError("Proposal missing")
  for (let index = 0; index < 40; index += 1) await fixture.run()
  expect(fixture.session.runs.size).toBe(32)
  expect(fixture.runs.snapshot(fixture.session, first.id).status).toBe("completed")
  fixture.session.proposals.delete(proposal.id)
  fixture.runs.recordDecision(fixture.session, first.id, {
    id: proposal.id,
    status: "rejected",
    summary: proposal.summary,
  })
  expect(fixture.runs.snapshot(fixture.session, first.id).proposal_decisions).toContainEqual({
    id: proposal.id,
    status: "rejected",
    summary: proposal.summary,
  })
  expect([...fixture.session.runs.keys()].at(-1)).toBe(first.id)
})
