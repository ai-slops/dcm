import type { NativeChart, NativeMusic } from "../../shared/index.ts"
import { tickToAudioMicros } from "./timing.ts"

export type IndexedAudioContact = {
  readonly key: string
  readonly kind: "tap" | "hold"
  readonly lane: number
  readonly headMicros: number
  readonly tailMicros: number
}

type NativePreviewContact = IndexedAudioContact & {
  readonly tick: number
  readonly holdTicks: number
}

export type ChartPreviewIndex<Contact extends IndexedAudioContact = IndexedAudioContact> = {
  readonly contacts: readonly Contact[]
  readonly maxTailMicros: readonly number[]
}

export type PreviewContact<Contact extends IndexedAudioContact = IndexedAudioContact> = Contact & {
  readonly headPosition: number
  readonly tailPosition: number
}

export type PreviewProjection<Contact extends IndexedAudioContact = IndexedAudioContact> = {
  readonly contacts: readonly PreviewContact<Contact>[]
  readonly hiddenContactCount: number
}

type ProjectionInput<Contact extends IndexedAudioContact> = {
  readonly index: ChartPreviewIndex<Contact>
  readonly audioMicros: number
  readonly pastMicros: number
  readonly lookaheadMicros: number
  readonly contactCap: number
}

export function buildChartPreviewIndex(
  chart: NativeChart,
  music: NativeMusic,
): ChartPreviewIndex<NativePreviewContact> {
  const contacts = chart.notes.flatMap((note) => {
    const headMicros = tickToAudioMicros(music, note.tick)
    const tailMicros =
      note.hold_ticks === 0 ? headMicros : tickToAudioMicros(music, note.tick + note.hold_ticks)
    return lanesInMask(note.panel_mask).map(
      (lane): NativePreviewContact => ({
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

export function projectVisibleContacts<Contact extends IndexedAudioContact>(
  input: ProjectionInput<Contact>,
): PreviewProjection<Contact> {
  const windowStart = input.audioMicros - input.pastMicros
  const windowEnd = input.audioMicros + input.lookaheadMicros
  const windowLength = input.pastMicros + input.lookaheadMicros
  const visible: PreviewContact<Contact>[] = []
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
