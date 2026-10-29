import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import type { Beat, BeatTiming } from "../../shared/beat.ts"
import { beatAtTimelineRow, timelineRowAtBeat } from "../domain/beat-timeline.ts"

const runwayRows = 4_000
const runwayCenterRow = runwayRows / 2
const bufferRows = 16

type VirtualTimelineInput = {
  readonly timing: BeatTiming
  readonly anchorBeat: Beat
}

type Geometry = {
  readonly originRow: number
  readonly rowSize: number
  readonly viewportSize: number
  readonly rowLimit: number | null
}

export function useTimelineVirtualScroll(input: VirtualTimelineInput) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const previousTiming = useRef(input.timing)
  const [originRow, setOriginRow] = useState(() =>
    timelineRowAtBeat(input.timing, input.anchorBeat),
  )
  const [rowSize, setRowSize] = useState(34)
  const [viewportSize, setViewportSize] = useState(680)
  const [scrollTop, setScrollTop] = useState(runwayCenterRow * rowSize)
  const rowLimit =
    input.timing.duration === null ? null : timelineRowAtBeat(input.timing, input.timing.duration)
  const geometryRef = useRef<Geometry>({ originRow, rowSize, viewportSize, rowLimit })
  geometryRef.current = { originRow, rowSize, viewportSize, rowLimit }
  const visibleRow = logicalVisibleRow(geometryRef.current, scrollTop)
  const virtualWindow = useMemo(() => {
    const viewportRows = Math.max(1, Math.ceil(viewportSize / rowSize))
    const startRow = Math.max(0, Math.floor(visibleRow) - bufferRows)
    const requestedEnd = Math.ceil(visibleRow) + viewportRows + bufferRows
    const endRow = rowLimit === null ? requestedEnd : Math.min(rowLimit + 1, requestedEnd)
    const rows = Array.from({ length: Math.max(0, endRow - startRow) }, (_, index) => {
      const row = startRow + index
      return { index: row, beat: beatAtTimelineRow(input.timing, row) }
    })
    return {
      visibleRow,
      startRow,
      rows,
      offset: (runwayCenterRow + startRow - originRow) * rowSize,
    }
  }, [input.timing, originRow, rowLimit, rowSize, viewportSize, visibleRow])

  const centerOnRow = useCallback((row: number) => {
    const nextRow = Math.max(0, row)
    const scroller = scrollerRef.current
    setOriginRow(nextRow)
    if (scroller === null) return
    const center = runwayCenterRow * geometryRef.current.rowSize
    scroller.scrollTop = center
    setScrollTop(center)
  }, [])

  const revealBeat = useCallback(
    (beat: Beat) => {
      const row = timelineRowAtBeat(input.timing, beat)
      const rowsVisible = Math.max(1, Math.floor(viewportSize / rowSize))
      if (row < visibleRow || row >= visibleRow + rowsVisible)
        centerOnRow(Math.max(0, row - Math.floor(rowsVisible / 3)))
    },
    [centerOnRow, input.timing, rowSize, viewportSize, visibleRow],
  )

  const followRow = useCallback(
    (row: number) => {
      const scroller = scrollerRef.current
      if (scroller === null) return
      const geometry = geometryRef.current
      const targetVisible = boundedVisibleRow(geometry, row - 1)
      const requested = (runwayCenterRow + targetVisible - geometry.originRow) * geometry.rowSize
      const physicalRow = requested / geometry.rowSize
      if (physicalRow < 500 || physicalRow > runwayRows - 500) {
        centerOnRow(targetVisible)
        return
      }
      scroller.scrollTop = requested
      setScrollTop(requested)
    },
    [centerOnRow],
  )

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const resize = () => {
      const nextRowSize = readRowSize(scroller)
      const nextViewportSize = scroller.clientHeight
      const current = geometryRef.current
      const anchoredRow = logicalVisibleRow(current, scroller.scrollTop)
      const nextGeometry = { ...current, rowSize: nextRowSize, viewportSize: nextViewportSize }
      const nextScrollTop = physicalScrollTop(nextGeometry, anchoredRow)
      if (!initialized.current) initialized.current = true
      geometryRef.current = nextGeometry
      scroller.scrollTop = nextScrollTop
      setRowSize(nextRowSize)
      setViewportSize(nextViewportSize)
      setScrollTop(nextScrollTop)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(scroller)
    window.addEventListener("resize", resize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", resize)
    }
  }, [])

  useLayoutEffect(() => {
    if (previousTiming.current === input.timing) return
    const oldBeat = beatAtTimelineRow(previousTiming.current, Math.floor(visibleRow))
    previousTiming.current = input.timing
    centerOnRow(timelineRowAtBeat(input.timing, oldBeat))
  }, [centerOnRow, input.timing, visibleRow])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const geometry = geometryRef.current
    const bounded = boundPhysicalScroll(geometry, scroller.scrollTop)
    if (bounded !== scroller.scrollTop) scroller.scrollTop = bounded
    const physicalRow = bounded / geometry.rowSize
    if (physicalRow < 500 || physicalRow > runwayRows - 500) {
      centerOnRow(logicalVisibleRow(geometry, bounded))
      return
    }
    setScrollTop(bounded)
  }, [centerOnRow])

  return {
    scrollerRef,
    virtualWindow,
    originRow,
    rowSize,
    runwaySize: runwayRows * rowSize,
    revealBeat,
    followRow,
    onScroll,
  }
}

function logicalVisibleRow(geometry: Geometry, scrollTop: number): number {
  const requested = geometry.originRow + scrollTop / geometry.rowSize - runwayCenterRow
  return boundedVisibleRow(geometry, requested)
}

function boundedVisibleRow(geometry: Geometry, row: number): number {
  const viewportRows = Math.max(1, Math.ceil(geometry.viewportSize / geometry.rowSize))
  const maximum =
    geometry.rowLimit === null
      ? Number.POSITIVE_INFINITY
      : Math.max(geometry.rowLimit - viewportRows + 1, 0)
  return Math.min(Math.max(row, 0), maximum)
}

function physicalScrollTop(geometry: Geometry, visibleRow: number): number {
  return boundPhysicalScroll(
    geometry,
    (runwayCenterRow + visibleRow - geometry.originRow) * geometry.rowSize,
  )
}

function boundPhysicalScroll(geometry: Geometry, scrollTop: number): number {
  const physicalMaximum = Math.max(runwayRows * geometry.rowSize - geometry.viewportSize, 0)
  const minimum = Math.min(
    Math.max((runwayCenterRow - geometry.originRow) * geometry.rowSize, 0),
    physicalMaximum,
  )
  if (geometry.rowLimit === null) return Math.min(Math.max(scrollTop, minimum), physicalMaximum)
  const maximum = Math.min(
    physicalScrollTopForRow(geometry, boundedVisibleRow(geometry, geometry.rowLimit)),
    physicalMaximum,
  )
  return Math.min(Math.max(scrollTop, minimum), Math.max(maximum, minimum))
}

function physicalScrollTopForRow(geometry: Geometry, row: number): number {
  return (runwayCenterRow + row - geometry.originRow) * geometry.rowSize
}

function readRowSize(scroller: HTMLElement): number {
  const parsed = Number.parseFloat(
    getComputedStyle(scroller).getPropertyValue("--timeline-row-size"),
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 34
}
