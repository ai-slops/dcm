import type { NativeMusic } from "../../shared/index.ts"

function microsPerBeat(music: NativeMusic, segmentIndex: number): number {
  const segment = music.tempo[segmentIndex]
  if (segment === undefined) return 0
  return segment.micros_per_beat.numerator / segment.micros_per_beat.denominator
}

export function tickToAudioMicros(music: NativeMusic, targetTick: number): number {
  const boundedTick = Math.min(Math.max(targetTick, 0), music.duration_ticks)
  let elapsedMicros = music.offset_micros

  for (const [index, segment] of music.tempo.entries()) {
    if (boundedTick <= segment.start_tick) break
    const nextSegment = music.tempo[index + 1]
    const segmentEnd = nextSegment?.start_tick ?? music.duration_ticks
    const elapsedTicks = Math.min(boundedTick, segmentEnd) - segment.start_tick
    elapsedMicros += (elapsedTicks * microsPerBeat(music, index)) / music.ticks_per_beat
  }

  return elapsedMicros
}

export function audioMicrosToTick(music: NativeMusic, audioMicros: number): number {
  let remainingMicros = Math.max(audioMicros - music.offset_micros, 0)

  for (const [index, segment] of music.tempo.entries()) {
    const nextSegment = music.tempo[index + 1]
    const segmentEnd = nextSegment?.start_tick ?? music.duration_ticks
    const segmentTicks = segmentEnd - segment.start_tick
    const beatMicros = microsPerBeat(music, index)
    const segmentMicros = (segmentTicks * beatMicros) / music.ticks_per_beat
    if (remainingMicros <= segmentMicros) {
      return segment.start_tick + (remainingMicros * music.ticks_per_beat) / beatMicros
    }
    remainingMicros -= segmentMicros
  }

  return music.duration_ticks
}
