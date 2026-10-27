export const TIMELINE_RUNWAY_ROWS = 4_000
export const TIMELINE_RUNWAY_CENTER_ROW = TIMELINE_RUNWAY_ROWS / 2

type TimelineScrollGeometry = {
  readonly originTick: number
  readonly rowSize: number
  readonly viewportSize: number
  readonly spanTicks: number
}

type TimelineFollowInput = TimelineScrollGeometry & {
  readonly tick: number
  readonly anchorRows: number
}

type TimelineResizeInput = TimelineScrollGeometry & {
  readonly scrollTop: number
  readonly nextRowSize: number
  readonly nextViewportSize: number
}

type TimelineSpanInput = TimelineScrollGeometry & {
  readonly scrollTop: number
  readonly nextSpanTicks: number
}

export type TimelineScrollBounds = {
  readonly minimum: number
  readonly maximum: number
}

export type TimelineFollowPosition = {
  readonly visibleTick: number
  readonly scrollTop: number
}

export type TimelineSpanPosition = TimelineFollowPosition & {
  readonly originTick: number
}

export function timelinePhysicalScrollBounds(input: TimelineScrollGeometry): TimelineScrollBounds {
  const viewportRows = Math.max(1, Math.ceil(input.viewportSize / input.rowSize))
  const maximumVisibleTick = Math.max(input.spanTicks - viewportRows, 0)
  const physicalMaximum = Math.max(TIMELINE_RUNWAY_ROWS * input.rowSize - input.viewportSize, 0)
  const minimum = Math.min(
    Math.max((TIMELINE_RUNWAY_CENTER_ROW - input.originTick) * input.rowSize, 0),
    physicalMaximum,
  )
  const maximum = Math.min(
    Math.max(
      (TIMELINE_RUNWAY_CENTER_ROW + maximumVisibleTick - input.originTick) * input.rowSize,
      minimum,
    ),
    physicalMaximum,
  )
  return { minimum, maximum }
}

export function timelineFollowPosition(input: TimelineFollowInput): TimelineFollowPosition {
  const viewportRows = Math.max(1, Math.ceil(input.viewportSize / input.rowSize))
  const maximumVisibleTick = Math.max(input.spanTicks - viewportRows, 0)
  const visibleTick = Math.min(Math.max(input.tick - input.anchorRows, 0), maximumVisibleTick)
  const bounds = timelinePhysicalScrollBounds(input)
  const requested = (TIMELINE_RUNWAY_CENTER_ROW + visibleTick - input.originTick) * input.rowSize
  return {
    visibleTick,
    scrollTop: Math.min(Math.max(requested, bounds.minimum), bounds.maximum),
  }
}

export function timelineLogicalVisibleTick(
  input: TimelineScrollGeometry & { readonly scrollTop: number },
): number {
  const viewportRows = Math.max(1, Math.ceil(input.viewportSize / input.rowSize))
  const maximumVisibleTick = Math.max(input.spanTicks - viewportRows, 0)
  const requested = input.originTick + input.scrollTop / input.rowSize - TIMELINE_RUNWAY_CENTER_ROW
  return Math.min(Math.max(requested, 0), maximumVisibleTick)
}

export function timelineResizePosition(input: TimelineResizeInput): TimelineFollowPosition {
  const previousVisibleTick = timelineLogicalVisibleTick(input)
  const nextGeometry = {
    originTick: input.originTick,
    rowSize: input.nextRowSize,
    viewportSize: input.nextViewportSize,
    spanTicks: input.spanTicks,
  }
  const nextViewportRows = Math.max(1, Math.ceil(input.nextViewportSize / input.nextRowSize))
  const visibleTick = Math.min(previousVisibleTick, Math.max(input.spanTicks - nextViewportRows, 0))
  const bounds = timelinePhysicalScrollBounds(nextGeometry)
  const requested =
    (TIMELINE_RUNWAY_CENTER_ROW + visibleTick - input.originTick) * input.nextRowSize
  return {
    visibleTick,
    scrollTop: Math.min(Math.max(requested, bounds.minimum), bounds.maximum),
  }
}

export function timelineSpanPosition(input: TimelineSpanInput): TimelineSpanPosition {
  const previousVisibleTick = timelineLogicalVisibleTick(input)
  const viewportRows = Math.max(1, Math.ceil(input.viewportSize / input.rowSize))
  const visibleTick = Math.min(previousVisibleTick, Math.max(input.nextSpanTicks - viewportRows, 0))
  const requested = (TIMELINE_RUNWAY_CENTER_ROW + visibleTick - input.originTick) * input.rowSize
  const physicalMaximum = Math.max(TIMELINE_RUNWAY_ROWS * input.rowSize - input.viewportSize, 0)
  if (requested < 0 || requested > physicalMaximum)
    return {
      originTick: visibleTick,
      visibleTick,
      scrollTop: TIMELINE_RUNWAY_CENTER_ROW * input.rowSize,
    }
  return { originTick: input.originTick, visibleTick, scrollTop: requested }
}
