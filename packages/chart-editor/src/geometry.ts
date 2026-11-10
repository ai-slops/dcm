/** Shared clipped hold geometry; no media clock or UI framework dependency. */
export function boundedTimelineNoteGeometry(input: {
  readonly headY: number
  readonly tailY: number
  readonly visibleStartY: number
  readonly visibleEndY: number
  readonly runwaySize: number
}): { readonly insetBlockStart: number; readonly blockSize: number } | null {
  const low = Math.max(0, input.visibleStartY),
    high = Math.min(input.runwaySize, input.visibleEndY)
  if (input.headY > high || input.tailY < low) return null
  const start = Math.max(input.headY, low)
  return { insetBlockStart: start, blockSize: Math.min(Math.max(input.tailY, start), high) - start }
}
