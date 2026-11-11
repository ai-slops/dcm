/** Pump lane symbols and display scale shared by canvas and SVG editors. */
export type GlyphPoint = readonly [number, number]
const arrow: readonly GlyphPoint[] = [
  [0, -1], [0.85, -0.05], [0.36, -0.05], [0.36, 0.9],
  [-0.36, 0.9], [-0.36, -0.05], [-0.85, -0.05],
]
const diamond: readonly GlyphPoint[] = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const angles = [-135, -45, 0, 45, 135]
const glyphs: readonly (readonly GlyphPoint[])[] = angles.map((degrees, lane) => {
  if (lane === 2) return diamond
  const radians = degrees * Math.PI / 180
  return arrow.map(([x, y]) => [x * Math.cos(radians) - y * Math.sin(radians), x * Math.sin(radians) + y * Math.cos(radians)] as const)
})
export function noteGlyph(lane: number): readonly GlyphPoint[] {
  if (!Number.isSafeInteger(lane) || lane < 0 || lane > 9) throw new RangeError("Invalid Pump lane")
  return glyphs[lane % 5] ?? diamond
}
export function noteGlyphPath(lane: number): string {
  return noteGlyph(lane).map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(5)} ${y.toFixed(5)}`).join(" ") + " Z"
}
export function noteGlyphSize(laneWidth: number): number {
  if (!Number.isFinite(laneWidth) || laneWidth <= 0) throw new RangeError("Invalid lane width")
  return Math.min(32, laneWidth * 0.72)
}
export function displaySeconds(viewportPixels: number, pixelsPerSecond: number): number {
  if (!Number.isFinite(viewportPixels) || viewportPixels <= 0 || !Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0)
    throw new RangeError("Display spacing must be positive")
  return viewportPixels / pixelsPerSecond
}
