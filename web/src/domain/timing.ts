import type { NativeMusic } from "../../shared/index.ts"

type TempoPoint = {
  readonly startTick: number
  readonly startElapsedMicros: number
  readonly microsPerTick: number
  readonly bpm: number
}

type TimingProjection = {
  readonly first: TempoPoint
  readonly segments: readonly TempoPoint[]
  readonly durationTicks: number
  readonly offsetMicros: number
}

const projections = new WeakMap<NativeMusic, TimingProjection>()

function projectionFor(music: NativeMusic): TimingProjection {
  const cached = projections.get(music)
  if (cached !== undefined) return cached
  let startElapsedMicros = 0
  const segments = music.tempo.map((segment, index) => {
    const microsPerBeat = segment.micros_per_beat.numerator / segment.micros_per_beat.denominator
    const microsPerTick = microsPerBeat / music.ticks_per_beat
    const point: TempoPoint = {
      startTick: segment.start_tick,
      startElapsedMicros,
      microsPerTick,
      bpm: 60_000_000 / microsPerBeat,
    }
    const endTick = music.tempo[index + 1]?.start_tick ?? music.duration_ticks
    startElapsedMicros += (endTick - segment.start_tick) * microsPerTick
    return point
  })
  const first = segments[0]
  if (first === undefined) throw new RangeError("A timing projection requires a tempo segment")
  const projection = {
    first,
    segments,
    durationTicks: music.duration_ticks,
    offsetMicros: music.offset_micros,
  }
  projections.set(music, projection)
  return projection
}

function segmentAt(
  projection: TimingProjection,
  target: number,
  coordinate: "startTick" | "startElapsedMicros",
): TempoPoint {
  let low = 0
  let high = projection.segments.length
  let selected = projection.first
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = projection.segments[middle]
    if (candidate === undefined)
      throw new RangeError("Timing projection index is outside its bounds")
    if (candidate[coordinate] <= target) {
      selected = candidate
      low = middle + 1
    } else high = middle
  }
  return selected
}

export function tickToAudioMicros(music: NativeMusic, targetTick: number): number {
  const projection = projectionFor(music)
  const tick = Math.min(Math.max(targetTick, 0), projection.durationTicks)
  const segment = segmentAt(projection, tick, "startTick")
  return (
    projection.offsetMicros +
    segment.startElapsedMicros +
    (tick - segment.startTick) * segment.microsPerTick
  )
}

export function audioMicrosToTick(music: NativeMusic, audioMicros: number): number {
  const projection = projectionFor(music)
  const micros = Math.max(audioMicros - projection.offsetMicros, 0)
  const segment = segmentAt(projection, micros, "startElapsedMicros")
  return Math.min(
    projection.durationTicks,
    segment.startTick + (micros - segment.startElapsedMicros) / segment.microsPerTick,
  )
}

export function bpmAtTick(music: NativeMusic, tick: number): number {
  return segmentAt(projectionFor(music), tick, "startTick").bpm
}
