import type { NativeChart, NativeNote } from "./native.ts"

export type UcsCellConflict = {
  readonly panel: number
  readonly tick: number
}

export function ucsCellConflict(notes: readonly NativeNote[]): UcsCellConflict | null {
  const ends = Array.from({ length: 10 }, () => -1)
  for (const note of [...notes].sort((left, right) => left.tick - right.tick)) {
    for (let panel = 0; panel < 10; panel += 1) {
      if ((note.panel_mask & (1 << panel)) === 0) continue
      if ((ends[panel] ?? -1) >= note.tick) return { panel, tick: note.tick }
      ends[panel] = note.tick + note.hold_ticks
    }
  }
  return null
}

export class UcsCellConflictError extends Error {
  override readonly name = "UcsCellConflictError"
  constructor(
    readonly panel: number,
    readonly tick: number,
  ) {
    super(`Lane ${panel + 1}, tick ${tick} already contains a note or hold tail`)
  }
}

export function assertUcsCellExclusive(chart: NativeChart): void {
  const conflict = ucsCellConflict(chart.notes)
  if (conflict !== null) throw new UcsCellConflictError(conflict.panel, conflict.tick)
  const tail = chart.notes.find(
    (note) => note.hold_ticks > 0 && note.tick + note.hold_ticks >= chart.span_ticks,
  )
  if (tail !== undefined)
    throw new UcsCellConflictError(
      Math.max(0, Math.log2(tail.panel_mask & -tail.panel_mask)),
      chart.span_ticks,
    )
}
