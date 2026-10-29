import type { Beat, BeatTiming } from "../../shared/beat.ts"

type TempoPoint = {
  readonly startBeat: number
  readonly startElapsedMicros: number
  readonly microsPerBeat: number
  readonly bpm: number
}

type BeatTimingProjection = {
  readonly first: TempoPoint
  readonly segments: readonly TempoPoint[]
  readonly offsetMicros: number
}

const projections = new WeakMap<BeatTiming, BeatTimingProjection>()

export function beatToAudioMicros(timing: BeatTiming, target: Beat): number {
  return beatPositionToAudioMicros(timing, beatNumber(target))
}

export function beatPositionToAudioMicros(timing: BeatTiming, target: number): number {
  const projection = projectionFor(timing)
  const bounded = Math.max(target, 0)
  const segment = segmentAt(projection, bounded, "startBeat")
  return (
    projection.offsetMicros +
    segment.startElapsedMicros +
    (bounded - segment.startBeat) * segment.microsPerBeat
  )
}

export function audioMicrosToBeatPosition(timing: BeatTiming, audioMicros: number): number | null {
  const projection = projectionFor(timing)
  if (audioMicros < projection.offsetMicros) return null
  const elapsed = audioMicros - projection.offsetMicros
  const segment = segmentAt(projection, elapsed, "startElapsedMicros")
  return segment.startBeat + (elapsed - segment.startElapsedMicros) / segment.microsPerBeat
}

export function bpmAtBeat(timing: BeatTiming, target: Beat): number {
  return bpmAtBeatPosition(timing, beatNumber(target))
}

export function bpmAtBeatPosition(timing: BeatTiming, target: number): number {
  return segmentAt(projectionFor(timing), Math.max(target, 0), "startBeat").bpm
}

export function beatNumber(value: Beat): number {
  return value.numerator / value.denominator
}

function projectionFor(timing: BeatTiming): BeatTimingProjection {
  const cached = projections.get(timing)
  if (cached !== undefined) return cached
  let startElapsedMicros = 0
  const segments = timing.tempo.map((segment, index) => {
    const startBeat = beatNumber(segment.at)
    const microsPerBeat = segment.micros_per_beat.numerator / segment.micros_per_beat.denominator
    const point = {
      startBeat,
      startElapsedMicros,
      microsPerBeat,
      bpm: 60_000_000 / microsPerBeat,
    }
    const next = timing.tempo[index + 1]
    if (next !== undefined) startElapsedMicros += (beatNumber(next.at) - startBeat) * microsPerBeat
    return point
  })
  const first = segments[0]
  if (first === undefined) throw new RangeError("Beat timing requires a tempo marker")
  const projection = { first, segments, offsetMicros: timing.offset_micros }
  projections.set(timing, projection)
  return projection
}

function segmentAt(
  projection: BeatTimingProjection,
  target: number,
  coordinate: "startBeat" | "startElapsedMicros",
): TempoPoint {
  let low = 0
  let high = projection.segments.length
  let selected = projection.first
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = projection.segments[middle]
    if (candidate === undefined) throw new RangeError("Beat timing projection index is invalid")
    if (candidate[coordinate] <= target) {
      selected = candidate
      low = middle + 1
    } else high = middle
  }
  return selected
}
