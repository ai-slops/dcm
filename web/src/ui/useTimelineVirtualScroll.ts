import type { RefObject } from "react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"

import type { BeatTiming } from "../../shared/beat.ts"
import {
  AUDIO_TIMELINE_RUNWAY_CENTER,
  AUDIO_TIMELINE_RUNWAY_SIZE,
  type AudioTimelineGeometry,
  type AudioTimelineRange,
  audioMicrosAtPhysicalY,
  audioMicrosToPhysicalY,
  audioTimelineFollowPosition,
  audioTimelineGeometry,
  audioTimelineRebasePosition,
  audioTimelineResizePosition,
  audioTimelineVisibleRange,
  audioTimelineZoomPosition,
} from "../domain/audio-timeline-geometry.ts"

const defaultRowSize = 34
const defaultViewportSize = 680

export type TimelineVirtualScrollInput = {
  readonly timing: BeatTiming
  readonly lookaheadSeconds: number
}

export type TimelineVirtualScroll = {
  readonly scrollerRef: RefObject<HTMLDivElement | null>
  readonly onScroll: () => void
  readonly visibleAudioRange: AudioTimelineRange
  readonly runwaySize: number
  readonly pixelsPerMicrosecond: number
  readonly audioMicrosToY: (audioMicros: number) => number
  readonly audioMicrosAtClientY: (clientY: number) => number
  readonly followAudioMicros: (audioMicros: number) => void
}

export function useTimelineVirtualScroll(input: TimelineVirtualScrollInput): TimelineVirtualScroll {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const previousLookahead = useRef(input.lookaheadSeconds)
  const initialGeometry = useRef(
    audioTimelineGeometry({
      originAudioMicros: input.timing.offset_micros,
      viewportSize: defaultViewportSize,
      judgmentOffset: defaultRowSize,
      lookaheadSeconds: input.lookaheadSeconds,
    }),
  )
  const [geometry, setGeometry] = useState(initialGeometry.current)
  const [scrollTop, setScrollTop] = useState(
    AUDIO_TIMELINE_RUNWAY_CENTER - initialGeometry.current.judgmentOffset,
  )
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  const updatePosition = useCallback(
    (position: { readonly geometry: AudioTimelineGeometry; readonly scrollTop: number }) => {
      geometryRef.current = position.geometry
      const scroller = scrollerRef.current
      if (scroller !== null) scroller.scrollTop = position.scrollTop
      setGeometry(position.geometry)
      setScrollTop(position.scrollTop)
    },
    [],
  )

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const resize = () => {
      const judgmentOffset = readRowSize(scroller)
      const headerSize =
        scroller.querySelector(".timeline__header")?.getBoundingClientRect().height ?? 0
      const viewportSize = Math.max(scroller.clientHeight - headerSize, judgmentOffset + 1)
      const nextGeometry = audioTimelineGeometry({
        originAudioMicros: geometryRef.current.originAudioMicros,
        viewportSize,
        judgmentOffset,
        lookaheadSeconds: input.lookaheadSeconds,
      })
      const resizePosition =
        previousLookahead.current === input.lookaheadSeconds
          ? audioTimelineResizePosition
          : audioTimelineZoomPosition
      const position = initialized.current
        ? resizePosition({
            geometry: geometryRef.current,
            scrollTop: scroller.scrollTop,
            nextViewportSize: viewportSize,
            nextJudgmentOffset: judgmentOffset,
            lookaheadSeconds: input.lookaheadSeconds,
          })
        : audioTimelineFollowPosition({
            geometry: nextGeometry,
            audioMicros: input.timing.offset_micros,
          })
      initialized.current = true
      previousLookahead.current = input.lookaheadSeconds
      updatePosition(position)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(scroller)
    window.addEventListener("resize", resize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", resize)
    }
  }, [input.lookaheadSeconds, input.timing.offset_micros, updatePosition])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const position = audioTimelineRebasePosition({
      geometry: geometryRef.current,
      scrollTop: scroller.scrollTop,
    })
    if (position.geometry !== geometryRef.current || position.scrollTop !== scroller.scrollTop) {
      updatePosition(position)
      return
    }
    setScrollTop(scroller.scrollTop)
  }, [updatePosition])

  const audioMicrosToY = useCallback(
    (audioMicros: number) => audioMicrosToPhysicalY(geometryRef.current, audioMicros),
    [],
  )

  const audioMicrosAtClientY = useCallback((clientY: number) => {
    const scroller = scrollerRef.current
    if (scroller === null) return geometryRef.current.originAudioMicros
    const headerSize =
      scroller.querySelector(".timeline__header")?.getBoundingClientRect().height ?? 0
    const physicalY =
      scroller.scrollTop + clientY - scroller.getBoundingClientRect().top - headerSize
    return audioMicrosAtPhysicalY(geometryRef.current, physicalY)
  }, [])

  const followAudioMicros = useCallback(
    (audioMicros: number) =>
      updatePosition(audioTimelineFollowPosition({ geometry: geometryRef.current, audioMicros })),
    [updatePosition],
  )

  return {
    scrollerRef,
    onScroll,
    visibleAudioRange: audioTimelineVisibleRange(geometry, scrollTop),
    runwaySize: AUDIO_TIMELINE_RUNWAY_SIZE,
    pixelsPerMicrosecond: geometry.pixelsPerMicrosecond,
    audioMicrosToY,
    audioMicrosAtClientY,
    followAudioMicros,
  }
}

function readRowSize(scroller: HTMLElement): number {
  const parsed = Number.parseFloat(
    getComputedStyle(scroller).getPropertyValue("--timeline-row-size"),
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultRowSize
}
