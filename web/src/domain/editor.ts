import type { NativeChart, NativeNote } from "../../shared/index.ts"
import { canonicalizeChart } from "../../shared/index.ts"

export type PanelIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

type PanelEdit = {
  readonly tick: number
  readonly panel: PanelIndex
  readonly holdTicks: number
  readonly action: "place" | "erase"
}

type ProposalEligibility = {
  readonly dirty: boolean
  readonly currentRevision: number
  readonly baseRevision: number
}

type PanelDemandUpdate = {
  readonly sourceTick: number
  readonly sourcePanel: PanelIndex
  readonly tick: number
  readonly panel: PanelIndex
  readonly holdTicks: number
}

function occupiesPanelAtTick(note: NativeNote, tick: number, panel: PanelIndex): boolean {
  if ((note.panel_mask & (1 << panel)) === 0) return false
  return (
    note.tick === tick ||
    (note.hold_ticks > 0 && note.tick < tick && note.tick + note.hold_ticks > tick)
  )
}

export function findPanelDemand(
  chart: NativeChart,
  tick: number,
  panel: PanelIndex,
): NativeNote | undefined {
  return chart.notes.find((note) => occupiesPanelAtTick(note, tick, panel))
}

export function editPanelAtTick(chart: NativeChart, edit: PanelEdit): NativeChart {
  const panelBit = 1 << edit.panel
  if (edit.action === "place") {
    return canonicalizeChart({
      ...chart,
      notes: [
        ...chart.notes,
        { tick: edit.tick, panel_mask: panelBit, hold_ticks: edit.holdTicks },
      ],
    })
  }

  const notes: NativeNote[] = []
  for (const note of chart.notes) {
    if (!occupiesPanelAtTick(note, edit.tick, edit.panel)) {
      notes.push(note)
      continue
    }
    const remainingMask = note.panel_mask & ~panelBit
    if (remainingMask > 0) notes.push({ ...note, panel_mask: remainingMask })
  }
  return canonicalizeChart({ ...chart, notes })
}

export function updatePanelDemand(chart: NativeChart, update: PanelDemandUpdate): NativeChart {
  const selected = findPanelDemand(chart, update.sourceTick, update.sourcePanel)
  if (selected === undefined) return chart

  const sourceBit = 1 << update.sourcePanel
  const remainingMask = selected.panel_mask & ~sourceBit
  const notes = chart.notes.flatMap((note) => {
    if (note !== selected) return [note]
    return remainingMask === 0 ? [] : [{ ...note, panel_mask: remainingMask }]
  })
  return canonicalizeChart({
    ...chart,
    notes: [
      ...notes,
      { tick: update.tick, panel_mask: 1 << update.panel, hold_ticks: update.holdTicks },
    ],
  })
}

export function canApplyProposal(eligibility: ProposalEligibility): boolean {
  return !eligibility.dirty && eligibility.currentRevision === eligibility.baseRevision
}
