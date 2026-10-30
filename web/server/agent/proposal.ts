import { beatOutputContextFor } from "../../shared/beat-output.ts"
import {
  type ChartProposal,
  ChartProposalSchema,
  type CurrentDocument,
  canonicalizeChart,
  RevisionSchema,
  type StudioProjectV1,
  StudioProjectV1Schema,
} from "../../shared/index.ts"
import { assertEditableChart } from "../chart-boundary.ts"
import { StudioError } from "../errors.ts"
import { nativeDocumentFor } from "../native/beat-document.ts"
import type { ProposalInput } from "./part-runtime.ts"

export function buildAgentProposal(
  document: CurrentDocument,
  input: ProposalInput,
  runId: string,
): ChartProposal {
  const chart = canonicalizeChart(input.chart)
  assertEditableChart(chart)
  const frozen = nativeDocumentFor(document.project, beatOutputContextFor(document))
  const project = StudioProjectV1Schema.parse({
    ...frozen,
    chart,
    ...(input.music === undefined ? {} : { music: input.music }),
  })
  if (JSON.stringify(project.music.audio_sha256) !== JSON.stringify(frozen.music.audio_sha256)) {
    throw new StudioError(
      400,
      "proposal_audio",
      "Proposal cannot replace the frozen audio identity",
    )
  }
  if (
    chart.ticks_per_beat !== project.music.ticks_per_beat ||
    chart.span_ticks !== project.music.duration_ticks
  ) {
    throw new StudioError(400, "proposal_profile", "Proposal differs from the frozen music profile")
  }
  return ChartProposalSchema.parse({
    id: crypto.randomUUID(),
    base_revision: RevisionSchema.parse(document.revision),
    source: "agent",
    run_id: runId,
    summary: input.summary,
    chart,
    before: { chart: frozen.chart, music: frozen.music },
    ...(input.music === undefined ? {} : { music: project.music }),
    changes: summarizeChanges(frozen, project),
  })
}

function summarizeChanges(
  beforeProject: StudioProjectV1,
  project: StudioProjectV1,
): NonNullable<ChartProposal["changes"]> {
  const before = new Set(beforeProject.chart.notes.map(noteKey))
  const after = new Set(project.chart.notes.map(noteKey))
  const changed = project.chart.notes.filter((note) => !before.has(noteKey(note)))
  const removed = beforeProject.chart.notes.filter((note) => !after.has(noteKey(note)))
  const ticks = [...changed, ...removed].map((note) => note.tick)
  const lanes = new Set<number>()
  for (const note of [...changed, ...removed]) {
    for (let lane = 0; lane < 10; lane += 1)
      if ((note.panel_mask & (1 << lane)) !== 0) lanes.add(lane)
  }
  const timingChanged = JSON.stringify(beforeProject.music) !== JSON.stringify(project.music)
  return {
    notes_added: changed.length,
    notes_removed: removed.length,
    timing_changed: timingChanged,
    offset_before: beforeProject.music.offset_micros,
    offset_after: project.music.offset_micros,
    ...(ticks.length === 0 ? {} : { tick_start: Math.min(...ticks), tick_end: Math.max(...ticks) }),
    lanes: [...lanes].sort((left, right) => left - right),
  }
}

function noteKey(note: StudioProjectV1["chart"]["notes"][number]): string {
  return `${note.tick}:${note.panel_mask}:${note.hold_ticks}`
}
