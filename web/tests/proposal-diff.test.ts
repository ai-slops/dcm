import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChartProposalSchema } from "../shared/index.ts"
import { ProposalCard } from "../src/ui/ProposalCard.tsx"

const zeroHash = Array.from({ length: 32 }, () => 0)

describe("proposal canonical change disclosure", () => {
  it("shows hidden hold and tempo changes even when the summary is misleading", () => {
    // Given
    const proposal = ChartProposalSchema.parse({
      id: "proposal-hidden-change",
      base_revision: 12,
      source: "agent",
      run_id: "run-owner",
      summary: "Only adjusts a tap label",
      before: {
        chart: {
          ticks_per_beat: 4,
          span_ticks: 32,
          notes: [{ tick: 8, panel_mask: 1, hold_ticks: 0 }],
        },
        music: {
          duration_ticks: 32,
          ticks_per_beat: 4,
          offset_micros: 0,
          tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
          audio_sha256: zeroHash,
          reference_accents: [8],
        },
      },
      chart: {
        ticks_per_beat: 4,
        span_ticks: 32,
        notes: [{ tick: 8, panel_mask: 1, hold_ticks: 8 }],
      },
      music: {
        duration_ticks: 32,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: [
          { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
          { start_tick: 16, micros_per_beat: { numerator: 400_000, denominator: 1 } },
        ],
        audio_sha256: zeroHash,
        reference_accents: [8],
      },
    })

    // When
    const markup = renderToStaticMarkup(
      createElement(ProposalCard, {
        proposal,
        eligible: true,
        busy: null,
        onApply: () => undefined,
        onReject: () => undefined,
      }),
    )

    // Then
    expect(markup).toContain("BASE R12")
    expect(markup).toContain("Agent · run run-owner")
    expect(markup).toContain("tick=8 mask=1 hold_ticks=0")
    expect(markup).toContain("tick=8 mask=1 hold_ticks=8")
    expect(markup).toContain("Tempo")
    expect(markup).toContain("start_tick=16")
    expect(markup).toContain("400000/1")
  })

  it("states when the canonical before snapshot is unavailable", () => {
    // Given
    const proposal = ChartProposalSchema.parse({
      id: "proposal-without-before",
      base_revision: 3,
      source: "native_generate",
      summary: "Generated candidate",
      chart: { ticks_per_beat: 4, span_ticks: 16, notes: [] },
    })

    // When
    const markup = renderToStaticMarkup(
      createElement(ProposalCard, {
        proposal,
        eligible: true,
        busy: null,
        onApply: () => undefined,
        onReject: () => undefined,
      }),
    )

    // Then
    expect(markup).toContain("Native generation · no agent run")
    expect(markup).toContain("Exact before snapshot unavailable")
  })
})
