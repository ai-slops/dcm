import {
  type ChartProposal,
  ChartProposalSchema,
  type CurrentDocument,
  canonicalizeChart,
  RevisionSchema,
  StudioProjectV1Schema,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { ProposalInput } from "./part-runtime.ts"

export function buildAgentProposal(
  document: CurrentDocument,
  input: ProposalInput,
  runId: string,
): ChartProposal {
  const chart = canonicalizeChart(input.chart)
  const project = StudioProjectV1Schema.parse({
    ...document.project,
    chart,
    ...(input.music === undefined ? {} : { music: input.music }),
  })
  if (
    JSON.stringify(project.music.audio_sha256) !==
    JSON.stringify(document.project.music.audio_sha256)
  ) {
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
    ...(input.music === undefined ? {} : { music: project.music }),
    changes: summarizeChanges(document, project),
  })
}

function summarizeChanges(
  document: CurrentDocument,
  project: CurrentDocument["project"],
): NonNullable<ChartProposal["changes"]> {
  const before = new Set(document.project.chart.notes.map(noteKey))
  const after = new Set(project.chart.notes.map(noteKey))
  const changed = project.chart.notes.filter((note) => !before.has(noteKey(note)))
  const removed = document.project.chart.notes.filter((note) => !after.has(noteKey(note)))
  const ticks = [...changed, ...removed].map((note) => note.tick)
  const lanes = new Set<number>()
  for (const note of [...changed, ...removed]) {
    for (let lane = 0; lane < 10; lane += 1)
      if ((note.panel_mask & (1 << lane)) !== 0) lanes.add(lane)
  }
  const timingChanged = JSON.stringify(document.project.music) !== JSON.stringify(project.music)
  return {
    notes_added: changed.length,
    notes_removed: removed.length,
    timing_changed: timingChanged,
    offset_before: document.project.music.offset_micros,
    offset_after: project.music.offset_micros,
    ...(ticks.length === 0 ? {} : { tick_start: Math.min(...ticks), tick_end: Math.max(...ticks) }),
    lanes: [...lanes].sort((left, right) => left - right),
  }
}

function noteKey(note: CurrentDocument["project"]["chart"]["notes"][number]): string {
  return `${note.tick}:${note.panel_mask}:${note.hold_ticks}`
}
