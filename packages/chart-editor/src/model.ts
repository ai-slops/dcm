/** Musical coordinates are exact. Source observations never acquire a guessed beat. */
export type Beat = { readonly numerator: number; readonly denominator: number }
export type BeatTiming = {
  readonly offset_micros: number
  readonly tempo: readonly {
    readonly at: Beat
    readonly micros_per_beat: Beat
  }[]
}
export type ReviewNote = {
  id: string
  lane: number
  kind: "tap" | "hold" | "unknown"
  start_seconds: number | null
  end_seconds: number | null
  observed_range: [number, number]
  beat?: Beat
  tail_beat?: Beat
  evidence: string[]
}
/** A tick is a chart-wide count event, independently of lane count or hold cells. */
export type HoldTick = { id: string; seconds: number; count: number | null; evidence: string[] }
export type ScrollEvent = { id: string; seconds: number; multiplier: number; evidence: string[] }
export type ReviewDocument = {
  schema: 1
  revision: number
  source: { id: string; size_bytes: number; mtime_ns: string }
  analysis_fingerprint: string
  coverage: [number, number]
  status: "draft" | "reviewed"
  notes: ReviewNote[]
  ticks: HoldTick[]
  scroll: ScrollEvent[]
  comment: string
}
export const laneLabels = ["DL", "UL", "C", "UR", "DR"]
export function validateReview(d: ReviewDocument): void {
  if (d.schema !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0)
    throw Error("Invalid review revision")
  const [a, b] = d.coverage
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || a >= b)
    throw Error("Choose an increasing review interval")
  const ids = new Set<string>()
  for (const row of [...d.notes, ...d.ticks, ...d.scroll]) {
    if (!row.id || ids.has(row.id)) throw Error("Each object needs a unique ID")
    ids.add(row.id)
  }
  for (const n of d.notes) {
    const [low, high] = n.observed_range
    if (
      !Number.isInteger(n.lane) ||
      n.lane < 0 ||
      n.lane > 9 ||
      !["tap", "hold", "unknown"].includes(n.kind)
    )
      throw Error("Invalid note lane or kind")
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < a || high > b || low > high)
      throw Error("Observation range lies outside review coverage")
    if (
      n.start_seconds !== null &&
      (!Number.isFinite(n.start_seconds) || n.start_seconds < a || n.start_seconds >= b)
    )
      throw Error("Head lies outside review coverage")
    if (
      n.end_seconds !== null &&
      (!Number.isFinite(n.end_seconds) || n.end_seconds < a || n.end_seconds > b)
    )
      throw Error("Tail lies outside review coverage")
    if (n.start_seconds !== null && n.end_seconds !== null && n.end_seconds < n.start_seconds)
      throw Error("Tail precedes head")
    if (n.kind === "tap" && (n.start_seconds === null || n.end_seconds !== n.start_seconds))
      throw Error("A tap needs one known time")
  }
  for (const t of d.ticks)
    if (
      !Number.isFinite(t.seconds) ||
      t.seconds < a ||
      t.seconds >= b ||
      (t.count !== null && (!Number.isSafeInteger(t.count) || t.count < 0))
    )
      throw Error("Invalid tick time or weight")
  for (const s of d.scroll)
    if (
      !Number.isFinite(s.seconds) ||
      s.seconds < a ||
      s.seconds >= b ||
      !Number.isFinite(s.multiplier)
    )
      throw Error("Invalid scroll event")
}
export type ReviewCommand =
  | { kind: "put-note"; note: ReviewNote }
  | { kind: "remove-note"; id: string }
export function editReview(d: ReviewDocument, c: ReviewCommand): ReviewDocument {
  const next = structuredClone(d)
  next.status = "draft"
  next.notes = next.notes.filter((n) => n.id !== (c.kind === "put-note" ? c.note.id : c.id))
  if (c.kind === "put-note") next.notes.push(structuredClone(c.note))
  validateReview(next)
  return next
}
/** UCS cannot preserve weighted/nonuniform tick events or independent scroll effects. */
export function ucsLosses(d: ReviewDocument): string[] {
  return [
    ...(d.ticks.length ? ["Explicit tick schedule requires a separate sidecar"] : []),
    ...(d.scroll.length ? ["Independent scroll effects require a separate sidecar"] : []),
    ...(d.notes.some((n) => n.start_seconds === null || n.end_seconds === null || !n.beat)
      ? ["Unresolved endpoints or beat placement cannot be exported"]
      : []),
  ]
}
