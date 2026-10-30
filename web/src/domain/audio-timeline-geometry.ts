export const AUDIO_TIMELINE_RUNWAY_SIZE = 4_000_000
export const AUDIO_TIMELINE_RUNWAY_CENTER = AUDIO_TIMELINE_RUNWAY_SIZE / 2

const rebaseMargin = AUDIO_TIMELINE_RUNWAY_SIZE / 8

export type AudioTimelineRange = {
  readonly startMicros: number
  readonly endMicros: number
}

export type AudioTimelineGeometry = {
  readonly originAudioMicros: number
  readonly viewportSize: number
  readonly judgmentOffset: number
  readonly pixelsPerMicrosecond: number
}

export type AudioTimelineGeometryInput = {
  readonly originAudioMicros: number
  readonly viewportSize: number
  readonly judgmentOffset: number
  readonly lookaheadSeconds: number
}

export type AudioTimelinePosition = {
  readonly geometry: AudioTimelineGeometry
  readonly scrollTop: number
}

export function audioTimelineGeometry(input: AudioTimelineGeometryInput): AudioTimelineGeometry {
  const futureSize = input.viewportSize - input.judgmentOffset
  if (futureSize <= 0) throw new RangeError("Timeline judgment must be above the viewport bottom")
  if (!Number.isFinite(input.lookaheadSeconds) || input.lookaheadSeconds <= 0)
    throw new RangeError("Timeline lookahead must be positive")
  return {
    originAudioMicros: input.originAudioMicros,
    viewportSize: input.viewportSize,
    judgmentOffset: input.judgmentOffset,
    pixelsPerMicrosecond: futureSize / (input.lookaheadSeconds * 1_000_000),
  }
}

export function audioMicrosToPhysicalY(
  geometry: AudioTimelineGeometry,
  audioMicros: number,
): number {
  return (
    AUDIO_TIMELINE_RUNWAY_CENTER +
    (audioMicros - geometry.originAudioMicros) * geometry.pixelsPerMicrosecond
  )
}

export function audioMicrosAtPhysicalY(geometry: AudioTimelineGeometry, physicalY: number): number {
  return (
    geometry.originAudioMicros +
    (physicalY - AUDIO_TIMELINE_RUNWAY_CENTER) / geometry.pixelsPerMicrosecond
  )
}

export function audioTimelineVisibleRange(
  geometry: AudioTimelineGeometry,
  scrollTop: number,
): AudioTimelineRange {
  return {
    startMicros: audioMicrosAtPhysicalY(geometry, scrollTop),
    endMicros: audioMicrosAtPhysicalY(geometry, scrollTop + geometry.viewportSize),
  }
}

export function audioTimelineFollowPosition(input: {
  readonly geometry: AudioTimelineGeometry
  readonly audioMicros: number
}): AudioTimelinePosition {
  const requested =
    audioMicrosToPhysicalY(input.geometry, input.audioMicros) - input.geometry.judgmentOffset
  if (canStayOnRunway(input.geometry, requested))
    return { geometry: input.geometry, scrollTop: boundedScrollTop(input.geometry, requested) }
  const geometry = {
    ...input.geometry,
    originAudioMicros:
      input.audioMicros - input.geometry.judgmentOffset / input.geometry.pixelsPerMicrosecond,
  }
  return { geometry, scrollTop: AUDIO_TIMELINE_RUNWAY_CENTER }
}

export function audioTimelineResizePosition(input: {
  readonly geometry: AudioTimelineGeometry
  readonly scrollTop: number
  readonly nextViewportSize: number
  readonly nextJudgmentOffset: number
  readonly lookaheadSeconds: number
}): AudioTimelinePosition {
  const visible = audioTimelineVisibleRange(input.geometry, input.scrollTop)
  const geometry = audioTimelineGeometry({
    originAudioMicros: input.geometry.originAudioMicros,
    viewportSize: input.nextViewportSize,
    judgmentOffset: input.nextJudgmentOffset,
    lookaheadSeconds: input.lookaheadSeconds,
  })
  const requested = audioMicrosToPhysicalY(geometry, visible.startMicros)
  if (canStayOnRunway(geometry, requested))
    return { geometry, scrollTop: boundedScrollTop(geometry, requested) }
  return {
    geometry: { ...geometry, originAudioMicros: visible.startMicros },
    scrollTop: AUDIO_TIMELINE_RUNWAY_CENTER,
  }
}

export function audioTimelineRebasePosition(input: {
  readonly geometry: AudioTimelineGeometry
  readonly scrollTop: number
}): AudioTimelinePosition {
  if (canStayOnRunway(input.geometry, input.scrollTop)) return input
  const visible = audioTimelineVisibleRange(input.geometry, input.scrollTop)
  return {
    geometry: { ...input.geometry, originAudioMicros: visible.startMicros },
    scrollTop: AUDIO_TIMELINE_RUNWAY_CENTER,
  }
}

export function audioTimelineZoomPosition(
  input: Parameters<typeof audioTimelineResizePosition>[0],
): AudioTimelinePosition {
  const resized = audioTimelineResizePosition(input)
  return audioTimelineFollowPosition({
    geometry: resized.geometry,
    audioMicros: audioMicrosAtPhysicalY(
      input.geometry,
      input.scrollTop + input.geometry.judgmentOffset,
    ),
  })
}

function canStayOnRunway(geometry: AudioTimelineGeometry, scrollTop: number): boolean {
  const maximum = AUDIO_TIMELINE_RUNWAY_SIZE - geometry.viewportSize
  return scrollTop >= rebaseMargin && scrollTop <= maximum - rebaseMargin
}

function boundedScrollTop(geometry: AudioTimelineGeometry, scrollTop: number): number {
  return Math.min(Math.max(scrollTop, 0), AUDIO_TIMELINE_RUNWAY_SIZE - geometry.viewportSize)
}
