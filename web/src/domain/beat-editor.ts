import type { Beat, BeatNote, BeatTiming } from "../../shared/beat.ts"
import { addBeats, BeatNoteSchema, compareBeats, subtractBeats } from "../../shared/beat.ts"
import type { PanelIndex } from "./editor.ts"

export class BeatEditConflictError extends Error {
  override readonly name = "BeatEditConflictError"
}

export function findBeatPanelDemand(
  notes: readonly BeatNote[],
  at: Beat,
  panel: PanelIndex,
): BeatNote | undefined {
  return notes.find((note) => occupiesPanel(note, at, panel))
}

export function toggleBeatPanel(
  notes: readonly BeatNote[],
  timing: BeatTiming,
  at: Beat,
  panel: PanelIndex,
): readonly BeatNote[] {
  const existing = findBeatPanelDemand(notes, at, panel)
  if (existing !== undefined) return erasePanelDemand(notes, existing, panel)
  assertWithinDuration(timing, at)
  assertPanelAvailable(notes, at, at, panel)
  return canonicalNotes([
    ...notes,
    { at, hold: { numerator: 0, denominator: 1 }, panel_mask: 1 << panel },
  ])
}

export function placeBeatHold(
  notes: readonly BeatNote[],
  timing: BeatTiming,
  first: Beat,
  last: Beat,
  panel: PanelIndex,
): readonly BeatNote[] {
  const head = compareBeats(first, last) <= 0 ? first : last
  const tail = compareBeats(first, last) <= 0 ? last : first
  if (compareBeats(head, tail) === 0) return toggleBeatPanel(notes, timing, head, panel)
  assertWithinDuration(timing, tail)
  assertPanelAvailable(notes, head, tail, panel)
  return canonicalNotes([
    ...notes,
    { at: head, hold: subtractBeats(tail, head), panel_mask: 1 << panel },
  ])
}

function erasePanelDemand(
  notes: readonly BeatNote[],
  existing: BeatNote,
  panel: PanelIndex,
): readonly BeatNote[] {
  const bit = 1 << panel
  return notes.flatMap((note) => {
    if (note !== existing) return [note]
    const panelMask = note.panel_mask & ~bit
    return panelMask === 0 ? [] : [{ ...note, panel_mask: panelMask }]
  })
}

function occupiesPanel(note: BeatNote, at: Beat, panel: PanelIndex): boolean {
  return (
    (note.panel_mask & (1 << panel)) !== 0 &&
    compareBeats(note.at, at) <= 0 &&
    compareBeats(addBeats(note.at, note.hold), at) >= 0
  )
}

function assertPanelAvailable(
  notes: readonly BeatNote[],
  head: Beat,
  tail: Beat,
  panel: PanelIndex,
): void {
  const conflict = notes.some(
    (note) =>
      (note.panel_mask & (1 << panel)) !== 0 &&
      compareBeats(note.at, tail) <= 0 &&
      compareBeats(addBeats(note.at, note.hold), head) >= 0,
  )
  if (conflict) throw new BeatEditConflictError("The target panel is already occupied.")
}

function assertWithinDuration(timing: BeatTiming, tail: Beat): void {
  if (timing.duration !== null && compareBeats(tail, timing.duration) >= 0)
    throw new BeatEditConflictError("The note exceeds the explicit duration.")
}

function canonicalNotes(notes: readonly BeatNote[]): readonly BeatNote[] {
  const grouped = new Map<string, BeatNote>()
  for (const note of notes) {
    const parsed = BeatNoteSchema.parse(note)
    const key = `${parsed.at.numerator}/${parsed.at.denominator}:${parsed.hold.numerator}/${parsed.hold.denominator}`
    const current = grouped.get(key)
    grouped.set(
      key,
      current === undefined
        ? parsed
        : { ...parsed, panel_mask: parsed.panel_mask | current.panel_mask },
    )
  }
  return [...grouped.values()].sort(
    (left, right) =>
      compareBeats(left.at, right.at) ||
      compareBeats(left.hold, right.hold) ||
      left.panel_mask - right.panel_mask,
  )
}
