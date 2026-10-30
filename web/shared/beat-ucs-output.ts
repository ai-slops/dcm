import {
  addBeats,
  type Beat,
  type BeatNote,
  type BeatTiming,
  compareBeats,
  subtractBeats,
} from "./beat.ts"

const UCS_SPLIT_LIMIT = 128n
const UCS_SECTION_LIMIT = 4_096

export type UcsOutputCapability =
  | {
      readonly code: "ucs_split_unsupported"
      readonly required_split: string
      readonly limit: 128
      readonly section_start: Beat
      readonly section_end: Beat
    }
  | {
      readonly code: "ucs_section_limit"
      readonly value: number
      readonly limit: 4_096
    }

export type UcsGridSectionsResult =
  | {
      readonly kind: "supported"
      readonly grid_sections: readonly {
        readonly at: Beat
        readonly rows_per_measure: number
      }[]
    }
  | { readonly kind: "unsupported"; readonly capability: UcsOutputCapability }

export function synthesizeUcsGridSections(
  timing: BeatTiming,
  notes: readonly BeatNote[],
  duration: Beat,
): UcsGridSectionsResult {
  const boundaries = uniqueSortedBeats([
    ...timing.tempo.map((segment) => segment.at),
    ...timing.grid_sections.map((section) => section.at),
    duration,
  ]).filter((beat) => compareBeats(beat, duration) <= 0)
  const sectionCount = boundaries.length - 1
  if (sectionCount > UCS_SECTION_LIMIT)
    return {
      kind: "unsupported",
      capability: { code: "ucs_section_limit", value: sectionCount, limit: UCS_SECTION_LIMIT },
    }

  const coordinates = uniqueSortedBeats(
    notes.flatMap((note) => [note.at, addBeats(note.at, note.hold)]),
  )
  const gridSections: { readonly at: Beat; readonly rows_per_measure: number }[] = []
  let coordinateIndex = 0
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1]
    const end = boundaries[index]
    if (start === undefined || end === undefined) continue
    let requiredSplit = BigInt(subtractBeats(end, start).denominator)
    while (
      coordinateIndex < coordinates.length &&
      compareBeats(coordinates[coordinateIndex] ?? start, start) <= 0
    )
      coordinateIndex += 1
    let localIndex = coordinateIndex
    while (
      localIndex < coordinates.length &&
      compareBeats(coordinates[localIndex] ?? end, end) < 0
    ) {
      const coordinate = coordinates[localIndex]
      if (coordinate !== undefined)
        requiredSplit = leastCommonMultiple(
          requiredSplit,
          BigInt(subtractBeats(coordinate, start).denominator),
        )
      if (requiredSplit > UCS_SPLIT_LIMIT) return splitUnsupported(requiredSplit, start, end)
      localIndex += 1
    }
    if (requiredSplit > UCS_SPLIT_LIMIT) return splitUnsupported(requiredSplit, start, end)
    gridSections.push({ at: start, rows_per_measure: Number(requiredSplit * 4n) })
    coordinateIndex = localIndex
  }
  return { kind: "supported", grid_sections: gridSections }
}

function uniqueSortedBeats(beats: readonly Beat[]): readonly Beat[] {
  const unique = new Map(beats.map((beat) => [`${beat.numerator}/${beat.denominator}`, beat]))
  return [...unique.values()].sort(compareBeats)
}

function splitUnsupported(required: bigint, start: Beat, end: Beat): UcsGridSectionsResult {
  return {
    kind: "unsupported",
    capability: {
      code: "ucs_split_unsupported",
      required_split: required.toString(),
      limit: 128,
      section_start: start,
      section_end: end,
    },
  }
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
  return (left / greatestCommonDivisor(left, right)) * right
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let dividend = left
  let divisor = right
  while (divisor !== 0n) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
