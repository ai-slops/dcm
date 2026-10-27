import type { NativeChart, NativeNote } from "../../shared/index.ts"
import { canonicalizeChart } from "../../shared/index.ts"
import { assertUcsCellExclusive } from "../../shared/ucs-cells.ts"

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

type PanelPoint = {
  readonly tick: number
  readonly panel: PanelIndex
}

type HoldGesture = {
  readonly startTick: number
  readonly endTick: number
  readonly panel: PanelIndex
}

function occupiesPanelAtTick(note: NativeNote, tick: number, panel: PanelIndex): boolean {
  if ((note.panel_mask & (1 << panel)) === 0) return false
  return (
    note.tick === tick ||
    (note.hold_ticks > 0 && note.tick < tick && note.tick + note.hold_ticks >= tick)
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
    const edited = canonicalizeChart({
      ...chart,
      notes: [
        ...chart.notes,
        { tick: edit.tick, panel_mask: panelBit, hold_ticks: edit.holdTicks },
      ],
    })
    assertUcsCellExclusive(edited)
    return edited
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

export function togglePanelAtTick(
  chart: NativeChart,
  point: PanelPoint,
  quantize: number,
): NativeChart {
  const existing = findPanelDemand(chart, point.tick, point.panel)
  if (existing !== undefined)
    return editPanelAtTick(chart, { ...point, holdTicks: 0, action: "erase" })
  const tick = snapTick(point.tick, quantize, chart.span_ticks)
  return editPanelAtTick(chart, { tick, panel: point.panel, holdTicks: 0, action: "place" })
}

export function placePanelHold(
  chart: NativeChart,
  gesture: HoldGesture,
  quantize: number,
): NativeChart {
  const first = snapTick(Math.min(gesture.startTick, gesture.endTick), quantize, chart.span_ticks)
  const last = snapTick(Math.max(gesture.startTick, gesture.endTick), quantize, chart.span_ticks)
  return editPanelAtTick(chart, {
    tick: first,
    panel: gesture.panel,
    holdTicks: last - first,
    action: "place",
  })
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
  const edited = canonicalizeChart({
    ...chart,
    notes: [
      ...notes,
      { tick: update.tick, panel_mask: 1 << update.panel, hold_ticks: update.holdTicks },
    ],
  })
  assertUcsCellExclusive(edited)
  return edited
}

export function canApplyProposal(eligibility: ProposalEligibility): boolean {
  return !eligibility.dirty && eligibility.currentRevision === eligibility.baseRevision
}

function snapTick(tick: number, quantize: number, spanTicks: number): number {
  return Math.floor(Math.min(Math.max(tick, 0), spanTicks - 1) / quantize) * quantize
}
