import { useEffect, useRef } from "react"

import { showsPlaybackClock } from "./audio-playback-state.ts"
import { type AudioPlaybackController, usePlaybackSnapshot } from "./useAudioPlayback.ts"

export function TimelinePlayhead({
  playback,
  start,
  pageTicks,
  followAudio,
}: {
  readonly playback: AudioPlaybackController
  readonly start: number
  readonly pageTicks: number
  readonly followAudio: boolean
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const tick = snapshot.chartTick
  const lineRef = useRef<HTMLDivElement>(null)
  const visible =
    showsPlaybackClock(snapshot.status) &&
    tick !== null &&
    tick >= start &&
    tick < start + pageTicks
  useEffect(() => {
    const line = lineRef.current
    if (!followAudio || !visible || line === null) return
    revealPlayhead(line)
  })
  useEffect(() => {
    const line = lineRef.current
    if (!followAudio || !visible || line === null) return
    const scroller = line.closest(".timeline__scroller")
    if (scroller === null) return
    const observer = new ResizeObserver(() => revealPlayhead(line))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [followAudio, visible])
  if (!visible || tick === null) return null
  return (
    <div
      aria-hidden="true"
      ref={lineRef}
      className="timeline__playhead"
      data-testid="timeline-playhead"
      style={{
        transform: `translateY(calc(${tick - start} * var(--timeline-row-size)))`,
      }}
    />
  )
}

function revealPlayhead(line: HTMLElement): void {
  const scroller = line.closest(".timeline__scroller")
  if (scroller === null || scroller.clientHeight === 0) return
  const viewport = scroller.getBoundingClientRect()
  const headerHeight =
    scroller.querySelector(".timeline__header")?.getBoundingClientRect().height ?? 0
  const rectangle = line.getBoundingClientRect()
  const top = viewport.top + headerHeight
  if (rectangle.top < top) scroller.scrollTop += rectangle.top - top
  else if (rectangle.bottom > viewport.bottom)
    scroller.scrollTop += rectangle.bottom - viewport.bottom
}
