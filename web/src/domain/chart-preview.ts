import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { tickToAudioMicros } from "./timing.ts"

type IndexedPreviewContact = {
  readonly key: string
  readonly kind: "tap" | "hold"
  readonly lane: number
  readonly tick: number
  readonly holdTicks: number
  readonly headMicros: number
  readonly tailMicros: number
}

export type ChartPreviewIndex = {
  readonly contacts: readonly IndexedPreviewContact[]
  readonly maxTailMicros: readonly number[]
}

export type PreviewContact = IndexedPreviewContact & {
  readonly headPosition: number
  readonly tailPosition: number
}

export type PreviewProjection = {
  readonly contacts: readonly PreviewContact[]
  readonly hiddenContactCount: number
}

type ProjectionInput = {
  readonly index: ChartPreviewIndex
  readonly audioMicros: number
  readonly pastMicros: number
  readonly lookaheadMicros: number
  readonly contactCap: number
}

export function buildChartPreviewIndex(chart: NativeChart, music: NativeMusic): ChartPreviewIndex {
  const contacts = chart.notes.flatMap((note) => {
    const headMicros = tickToAudioMicros(music, note.tick)
    const tailMicros =
      note.hold_ticks === 0 ? headMicros : tickToAudioMicros(music, note.tick + note.hold_ticks)
    return lanesInMask(note.panel_mask).map(
      (lane): IndexedPreviewContact => ({
        key: `${note.tick}:${note.hold_ticks}:${lane}`,
        kind: note.hold_ticks === 0 ? "tap" : "hold",
        lane,
        tick: note.tick,
        holdTicks: note.hold_ticks,
        headMicros,
        tailMicros,
      }),
    )
  })
  const maxTailMicros: number[] = []
  let maximum = Number.NEGATIVE_INFINITY
  for (const contact of contacts) {
    maximum = Math.max(maximum, contact.tailMicros)
    maxTailMicros.push(maximum)
  }
  return { contacts, maxTailMicros }
}

export function projectVisibleContacts(input: ProjectionInput): PreviewProjection {
  const windowStart = input.audioMicros - input.pastMicros
  const windowEnd = input.audioMicros + input.lookaheadMicros
  const windowLength = input.pastMicros + input.lookaheadMicros
  const visible: PreviewContact[] = []
  let visibleCount = 0
  const start = firstIntersectingContact(input.index.maxTailMicros, windowStart)
  for (let position = start; position < input.index.contacts.length; position += 1) {
    const contact = input.index.contacts[position]
    if (contact === undefined || contact.headMicros > windowEnd) break
    if (contact.tailMicros < windowStart) continue
    visibleCount += 1
    if (visible.length >= Math.max(0, input.contactCap)) continue
    visible.push({
      ...contact,
      headPosition: positionInWindow(contact.headMicros, windowStart, windowLength),
      tailPosition: positionInWindow(contact.tailMicros, windowStart, windowLength),
    })
  }
  return { contacts: visible, hiddenContactCount: visibleCount - visible.length }
}

function firstIntersectingContact(maxTailMicros: readonly number[], windowStart: number): number {
  let low = 0
  let high = maxTailMicros.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((maxTailMicros[middle] ?? Number.NEGATIVE_INFINITY) >= windowStart) high = middle
    else low = middle + 1
  }
  return low
}

function lanesInMask(mask: number): readonly number[] {
  return Array.from({ length: 10 }, (_, lane) => lane).filter((lane) => (mask & (1 << lane)) !== 0)
}

function positionInWindow(audioMicros: number, startMicros: number, lengthMicros: number): number {
  if (lengthMicros <= 0) return 0
  return Math.min(Math.max((audioMicros - startMicros) / lengthMicros, 0), 1)
}
