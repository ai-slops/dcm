/** Shared framework-independent, bounded source-time chart editor. */
import { noteGlyph, noteGlyphSize } from "./glyphs.ts"
import { laneLabels, type ReviewNote, type HoldTick } from "./model.ts"
export type ChartView = {
  start: number
  end: number
  lanes: number
  notes: ReviewNote[]
  ticks: HoldTick[]
  observations: ReviewNote[]
  selected: string | null
}
const colors = ["#f18a97", "#77bce8", "#e9d475", "#77bce8", "#f18a97"]
export function drawChart(canvas: HTMLCanvasElement, v: ChartView): void {
  const ratio = window.devicePixelRatio || 1,
    width = canvas.clientWidth,
    height = canvas.clientHeight
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const c = canvas.getContext("2d")
  if (!c) return
  c.scale(ratio, ratio)
  const left = 64,
    top = 30,
    lane = (width - left) / v.lanes,
    y = (s: number) => top + ((s - v.start) / (v.end - v.start)) * (height - top)
  const size = noteGlyphSize(lane)
  canvas.dataset.noteSize = String(size)
  c.fillStyle = "#151c20"
  c.fillRect(0, 0, width, height)
  c.font = "12px system-ui"
  for (let i = 0; i < v.lanes; i++) {
    c.strokeStyle = "#364046"
    c.beginPath()
    c.moveTo(left + i * lane, 0)
    c.lineTo(left + i * lane, height)
    c.stroke()
    c.fillStyle = colors[i % 5]
    c.fillText(laneLabels[i % 5]!, left + (i + 0.5) * lane - 9, 19)
  }
  const step = v.end - v.start > 15 ? 2 : 0.5
  for (let s = Math.ceil(v.start / step) * step; s < v.end; s += step) {
    c.strokeStyle = "#303a40"
    c.beginPath()
    c.moveTo(left, y(s))
    c.lineTo(width, y(s))
    c.stroke()
    c.fillStyle = "#b0bec5"
    c.fillText(s.toFixed(2), 3, y(s) + 4)
  }
  const paint = (n: ReviewNote, ghost: boolean) => {
    const start = n.start_seconds ?? n.observed_range[0],
      end = n.end_seconds ?? n.observed_range[1]
    if (end < v.start || start > v.end) return
    const x = left + (n.lane + 0.5) * lane,
      head = y(start),
      tail = y(end)
    c.globalAlpha = ghost ? 0.35 : 1
    c.strokeStyle = colors[n.lane % 5]
    c.fillStyle = colors[n.lane % 5]
    if (n.kind === "hold" || n.kind === "unknown") {
      c.lineWidth = ghost ? 3 : 9
      c.setLineDash(n.kind === "unknown" ? [4, 4] : [])
      c.beginPath()
      c.moveTo(x, Math.max(top, head))
      c.lineTo(x, Math.min(height, tail))
      c.stroke()
      c.setLineDash([])
    }
    for (const [time, py] of [
      [n.start_seconds, head],
      [n.kind === "tap" ? null : n.end_seconds, tail],
    ] as const) {
      if (time === null || py < top || py > height) continue
      c.beginPath()
      noteGlyph(n.lane).forEach(([gx, gy], index) => {
        const px = x + gx * size / 2.2, ny = py + gy * size / 2.2
        if (index === 0) c.moveTo(px, ny)
        else c.lineTo(px, ny)
      })
      c.closePath()
      c.fill()
      c.strokeStyle = "#e7efed"
      c.lineWidth = 0.8
      c.stroke()
    }
    if (v.selected === n.id) {
      c.strokeStyle = "#ffffff"
      c.lineWidth = 2
      c.strokeRect(
        x - lane * 0.4,
        Math.max(top, head) - 7,
        lane * 0.8,
        Math.max(14, Math.min(height, tail) - Math.max(top, head) + 14),
      )
    }
    c.globalAlpha = 1
  }
  c.save()
  c.beginPath()
  c.rect(left, top, width - left, height - top)
  c.clip()
  v.observations.forEach((n) => paint(n, true))
  v.notes.forEach((n) => paint(n, false))
  for (const t of v.ticks) {
    if (t.seconds < v.start || t.seconds > v.end) continue
    c.fillStyle = "#c3dfa4"
    c.fillText(`×${t.count ?? "?"}`, left + 3, y(t.seconds) - 5)
  }
  c.restore()
}
export function chartPoint(
  canvas: HTMLCanvasElement,
  v: ChartView,
  x: number,
  y: number,
): { lane: number; seconds: number } | null {
  const r = canvas.getBoundingClientRect(),
    lane = Math.floor((x - r.left - 64) / ((r.width - 64) / v.lanes))
  if (lane < 0 || lane >= v.lanes || y - r.top < 30) return null
  return { lane, seconds: v.start + ((y - r.top - 30) / (r.height - 30)) * (v.end - v.start) }
}
