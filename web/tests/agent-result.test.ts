import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AgentRunSnapshotSchema } from "../shared/index.ts"
import { ProposalDecisionHistory } from "../src/ui/ProposalDecisionHistory.tsx"
import { RunResult } from "../src/ui/RunResult.tsx"

describe("agent run result", () => {
  it("labels streamed text as partial output while the run is active", () => {
    // Given / When
    const markup = renderToStaticMarkup(
      createElement(RunResult, { text: "Checking timing...", status: "running" }),
    )

    // Then
    expect(markup).toContain("Partial response")
    expect(markup).not.toContain("Run result")
  })

  it("labels retained output as failed when the canonical run failed", () => {
    // Given / When
    const markup = renderToStaticMarkup(
      createElement(RunResult, { text: "I could not finish the change.", status: "failed" }),
    )

    // Then
    expect(markup).toContain("Run failed")
    expect(markup).not.toContain("Run result")
  })

  it("uses completed semantics only for completed runs", () => {
    // Given / When
    const markup = renderToStaticMarkup(
      createElement(RunResult, { text: "Timing checked.", status: "completed" }),
    )

    // Then
    expect(markup).toContain("Run result")
  })
})

describe("proposal decision history", () => {
  it("retains applied and rejected decisions from the canonical snapshot", () => {
    // Given
    const snapshot = AgentRunSnapshotSchema.parse({
      id: "run-1",
      base_revision: 4,
      status: "completed",
      prompt: "Simplify the chart",
      last_sequence: 9,
      proposal_decisions: [
        { id: "proposal-1", status: "applied", revision: 5, summary: "Simplify left pad" },
        { id: "proposal-2", status: "rejected", summary: "Change the tempo" },
      ],
    })

    // When
    const markup = renderToStaticMarkup(
      createElement(ProposalDecisionHistory, { decisions: snapshot.proposal_decisions ?? [] }),
    )

    // Then
    expect(markup).toContain("Proposal decision history")
    expect(markup).toContain("Simplify left pad")
    expect(markup).toContain("Applied at revision R5")
    expect(markup).toContain("Change the tempo")
    expect(markup).toContain("Rejected")
  })
})
