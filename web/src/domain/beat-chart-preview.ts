import { addBeats, type Beat, type BeatNote, type BeatTiming } from "../../shared/index.ts"
import { beatToAudioMicros } from "./beat-timing.ts"
import type { ChartPreviewIndex, IndexedAudioContact } from "./chart-preview.ts"

export type BeatPreviewContact = IndexedAudioContact & {
  readonly at: Beat
  readonly hold: Beat
}

export function buildBeatChartPreviewIndex(
  notes: readonly BeatNote[],
  timing: BeatTiming,
): ChartPreviewIndex<BeatPreviewContact> {
  const contacts = notes.flatMap((note) => {
    const headMicros = beatToAudioMicros(timing, note.at)
    const tailMicros =
      note.hold.numerator === 0
        ? headMicros
        : beatToAudioMicros(timing, addBeats(note.at, note.hold))
    return lanesInMask(note.panel_mask).map(
      (lane): BeatPreviewContact => ({
        key: `${note.at.numerator}/${note.at.denominator}:${note.hold.numerator}/${note.hold.denominator}:${lane}`,
        kind: note.hold.numerator === 0 ? "tap" : "hold",
        lane,
        at: note.at,
        hold: note.hold,
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

function lanesInMask(mask: number): readonly number[] {
  return Array.from({ length: 10 }, (_, lane) => lane).filter((lane) => (mask & (1 << lane)) !== 0)
}
