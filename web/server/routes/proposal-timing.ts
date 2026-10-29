import { resolveChartOutputTiming } from "../../shared/beat-output.ts"
import {
  type Beat,
  type BeatChartDocument,
  type BeatTiming,
  beatFromTicks,
  type ChartProposal,
  compareBeats,
} from "../../shared/index.ts"

export function applyProposalSource(
  current: BeatChartDocument,
  proposal: ChartProposal,
): BeatChartDocument {
  const music = proposal.music
  const source = current.timing
  const outputEnd = resolveChartOutputTiming(current)?.duration ?? { numerator: 0, denominator: 1 }
  const timing: BeatTiming =
    music === undefined
      ? source
      : {
          ...source,
          offset_micros: music.offset_micros,
          duration:
            source.duration === null
              ? null
              : beatFromTicks(music.duration_ticks, music.ticks_per_beat),
          tempo: mergePositions(
            source.duration === null
              ? source.tempo.filter((segment) => compareBeats(segment.at, outputEnd) >= 0)
              : [],
            music.tempo.map((segment) => ({
              at: beatFromTicks(segment.start_tick, music.ticks_per_beat),
              micros_per_beat: segment.micros_per_beat,
            })),
          ),
          reference_accents: mergePositions(
            source.duration === null
              ? source.reference_accents
                  .filter((at) => compareBeats(at, outputEnd) >= 0)
                  .map((at) => ({ at }))
              : [],
            music.reference_accents.map((tick) => ({
              at: beatFromTicks(tick, music.ticks_per_beat),
            })),
          ).map(({ at }) => at),
        }
  return {
    ...current,
    timing,
    notes: proposal.chart.notes.map((note) => ({
      at: beatFromTicks(note.tick, proposal.chart.ticks_per_beat),
      hold: beatFromTicks(note.hold_ticks, proposal.chart.ticks_per_beat),
      panel_mask: note.panel_mask,
    })),
  }
}

function mergePositions<T extends { readonly at: Beat }>(
  tail: readonly T[],
  replacement: readonly T[],
): readonly T[] {
  return [
    ...new Map(
      [...tail, ...replacement].map((value) => [
        `${value.at.numerator}/${value.at.denominator}`,
        value,
      ]),
    ).values(),
  ].sort((left, right) => compareBeats(left.at, right.at))
}
