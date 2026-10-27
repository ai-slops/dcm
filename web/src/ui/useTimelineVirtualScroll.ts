import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  TIMELINE_RUNWAY_CENTER_ROW,
  TIMELINE_RUNWAY_ROWS,
  timelineFollowPosition,
  timelinePhysicalScrollBounds,
  timelineResizePosition,
  timelineSpanPosition,
  timelineVirtualWindow,
} from "../domain/timeline.ts"

type VirtualTimelineInput = {
  readonly spanTicks: number
  readonly anchorTick: number
}

type CurrentGeometry = {
  originTick: number
  rowSize: number
  viewportSize: number
  spanTicks: number
}

export function useTimelineVirtualScroll(input: VirtualTimelineInput) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const [originTick, setOriginTick] = useState(input.anchorTick)
  const [rowSize, setRowSize] = useState(34)
  const [viewportSize, setViewportSize] = useState(680)
  const [scrollTop, setScrollTop] = useState(TIMELINE_RUNWAY_CENTER_ROW * rowSize)
  const geometryRef = useRef<CurrentGeometry>({
    originTick: input.anchorTick,
    rowSize,
    viewportSize,
    spanTicks: input.spanTicks,
  })
  geometryRef.current.originTick = originTick
  const virtualWindow = useMemo(
    () =>
      timelineVirtualWindow({
        originTick,
        scrollTop,
        rowSize,
        viewportSize,
        spanTicks: input.spanTicks,
      }),
    [input.spanTicks, originTick, rowSize, scrollTop, viewportSize],
  )

  const centerOnTick = useCallback((tick: number) => {
    const scroller = scrollerRef.current
    geometryRef.current.originTick = tick
    setOriginTick(tick)
    if (scroller === null) return
    const center = TIMELINE_RUNWAY_CENTER_ROW * geometryRef.current.rowSize
    scroller.scrollTop = center
    setScrollTop(center)
  }, [])

  const revealTick = useCallback(
    (tick: number) => {
      const visibleRows = Math.max(1, Math.floor(viewportSize / rowSize))
      if (tick < virtualWindow.visibleTick || tick >= virtualWindow.visibleTick + visibleRows)
        centerOnTick(Math.max(0, tick - Math.floor(visibleRows / 3)))
    },
    [centerOnTick, rowSize, viewportSize, virtualWindow.visibleTick],
  )

  const followTick = useCallback(
    (tick: number) => {
      const scroller = scrollerRef.current
      if (scroller === null) return
      const geometry = geometryRef.current
      const position = timelineFollowPosition({
        tick,
        anchorRows: Math.max(1, Math.floor(geometry.viewportSize / geometry.rowSize / 3)),
        ...geometry,
      })
      const physicalRow = position.scrollTop / geometry.rowSize
      if (physicalRow < 500 || physicalRow > TIMELINE_RUNWAY_ROWS - 500) {
        centerOnTick(position.visibleTick)
        return
      }
      if (scroller.scrollTop === position.scrollTop) return
      scroller.scrollTop = position.scrollTop
      setScrollTop(position.scrollTop)
    },
    [centerOnTick],
  )

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const resize = () => {
      const nextRowSize = readRowSize(scroller)
      const nextViewportSize = scroller.clientHeight
      const current = geometryRef.current
      if (!initialized.current) {
        initialized.current = true
        const center = TIMELINE_RUNWAY_CENTER_ROW * nextRowSize
        geometryRef.current = { ...current, rowSize: nextRowSize, viewportSize: nextViewportSize }
        scroller.scrollTop = center
        setRowSize(nextRowSize)
        setViewportSize(nextViewportSize)
        setScrollTop(center)
        return
      }
      if (current.rowSize === nextRowSize && current.viewportSize === nextViewportSize) return
      const position = timelineResizePosition({
        ...current,
        scrollTop: scroller.scrollTop,
        nextRowSize,
        nextViewportSize,
      })
      geometryRef.current = { ...current, rowSize: nextRowSize, viewportSize: nextViewportSize }
      scroller.scrollTop = position.scrollTop
      setRowSize(nextRowSize)
      setViewportSize(nextViewportSize)
      setScrollTop(position.scrollTop)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(scroller)
    window.addEventListener("resize", resize)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", resize)
    }
  }, [])

  useLayoutEffect(() => {
    const current = geometryRef.current
    if (current.spanTicks === input.spanTicks) return
    const scroller = scrollerRef.current
    if (scroller === null) {
      geometryRef.current = { ...current, spanTicks: input.spanTicks }
      return
    }
    const position = timelineSpanPosition({
      ...current,
      scrollTop: scroller.scrollTop,
      nextSpanTicks: input.spanTicks,
    })
    geometryRef.current = {
      ...current,
      originTick: position.originTick,
      spanTicks: input.spanTicks,
    }
    scroller.scrollTop = position.scrollTop
    if (position.originTick !== current.originTick) setOriginTick(position.originTick)
    setScrollTop(position.scrollTop)
  }, [input.spanTicks])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const geometry = geometryRef.current
    const bounds = timelinePhysicalScrollBounds(geometry)
    const nextScrollTop = Math.min(Math.max(scroller.scrollTop, bounds.minimum), bounds.maximum)
    if (nextScrollTop !== scroller.scrollTop) scroller.scrollTop = nextScrollTop
    const physicalRow = nextScrollTop / geometry.rowSize
    const nextWindow = timelineVirtualWindow({
      originTick: geometry.originTick,
      scrollTop: nextScrollTop,
      rowSize: geometry.rowSize,
      viewportSize: geometry.viewportSize,
      spanTicks: geometry.spanTicks,
    })
    if (physicalRow < 500 || physicalRow > TIMELINE_RUNWAY_ROWS - 500) {
      centerOnTick(nextWindow.visibleTick)
      return
    }
    setScrollTop(nextScrollTop)
  }, [centerOnTick])

  return {
    scrollerRef,
    virtualWindow,
    originTick,
    rowSize,
    runwaySize: TIMELINE_RUNWAY_ROWS * rowSize,
    centerOnTick,
    revealTick,
    followTick,
    onScroll,
  }
}

function readRowSize(scroller: HTMLElement): number {
  const value = getComputedStyle(scroller).getPropertyValue("--timeline-row-size")
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 34
}
