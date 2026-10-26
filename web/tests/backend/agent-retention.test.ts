import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { AgentRunSnapshotSchema, BootstrapSchema, ChartProposalSchema } from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

it.each([false, true])(
  "applies a proposal after runtime eviction, with snapshot retained: %s",
  async (retainSnapshot) => {
    const root = await mkdtemp(join(tmpdir(), "pump-proposal-retention-"))
    try {
      const studio = await createStudioApp(
        loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
      )
      const response = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
      const boot = BootstrapSchema.parse(await response.json())
      const session = studio.sessions.get(boot.session_id)
      if (session === undefined) throw new TypeError("Session missing")
      if (retainSnapshot)
        session.runs.set(
          "evicted-run",
          AgentRunSnapshotSchema.parse({
            id: "evicted-run",
            base_revision: boot.document.revision,
            status: "completed",
            prompt: "Propose",
            last_sequence: 1,
          }),
        )
      const proposal = ChartProposalSchema.parse({
        id: "retained-proposal",
        run_id: "evicted-run",
        base_revision: boot.document.revision,
        source: "agent",
        summary: "Remove the last note",
        chart: {
          ...boot.document.project.chart,
          notes: boot.document.project.chart.notes.slice(0, -1),
        },
      })
      session.proposals.set(proposal.id, proposal)
      const applied = await studio.app.request(
        `http://127.0.0.1:4173/api/v1/proposals/${proposal.id}/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
            "x-csrf-token": boot.csrf_token,
          },
          body: JSON.stringify({ base_revision: boot.document.revision }),
        },
      )
      expect(applied.status).toBe(200)
      expect(studio.store.document().project.chart).toEqual(proposal.chart)
      if (retainSnapshot)
        expect(session.runs.get("evicted-run")?.proposal_decisions).toEqual([
          {
            id: proposal.id,
            status: "applied",
            revision: studio.store.document().revision,
            summary: proposal.summary,
          },
        ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
