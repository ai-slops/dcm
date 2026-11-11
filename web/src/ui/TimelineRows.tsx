import { noteGlyphPath } from "@piu/chart-editor/glyphs"
import { useMemo } from "react"

import type { Beat, BeatNote, BeatTiming } from "../../shared/beat.ts"
import { addBeats, beatFromTicks, compareBeats } from "../../shared/beat.ts"
import type { BeatTimelinePoint } from "../domain/beat-timeline.ts"
import { beatKey, formatBeat, laneTone, snapBeatToSelectedSplit } from "../domain/beat-timeline.ts"
import { beatToAudioMicros } from "../domain/beat-timing.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { laneLabels } from "./studio-types.ts"
import { boundedTimelineNoteGeometry } from "./timeline-editor-model.ts"

export type TimelineRegion = {
  readonly id: string
  readonly name: string
  readonly start: Beat
  readonly end: Beat
}

type TimelineRowsProps = {
  readonly points: readonly BeatTimelinePoint[]
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly lanes: readonly PanelIndex[]
  readonly selectedSplit: number
  readonly regions: readonly TimelineRegion[]
  readonly regionsReadOnly: boolean
  readonly readOnly: boolean
  readonly visibleAudioRange: { readonly startMicros: number; readonly endMicros: number }
  readonly runwaySize: number
  readonly audioMicrosToY: (audioMicros: number) => number
  readonly onOpenTempo: (beat: Beat) => void
}

export function TimelineRows(props: TimelineRowsProps) {
  const tempoByBeat = useMemo(
    () => new Map(props.timing.tempo.map((marker) => [beatKey(marker.at), marker])),
    [props.timing.tempo],
  )
  const notesByLane = useMemo(() => {
    const indexed = new Map<PanelIndex, BeatNote[]>(props.lanes.map((lane) => [lane, []]))
    for (const note of props.notes)
      for (const lane of props.lanes)
        if ((note.panel_mask & (1 << lane)) !== 0) indexed.get(lane)?.push(note)
    return indexed
  }, [props.lanes, props.notes])
  return (
    <>
      <TimelineNotes {...props} notesByLane={notesByLane} />
      {props.points.map((point, index) => {
        const region = regionAtBeat(props.regions, point.beat)
        const previous = props.points[index - 1]
        const previousRegion =
          previous === undefined ? undefined : regionAtBeat(props.regions, previous.beat)
        const tempo = tempoByBeat.get(beatKey(point.beat))
        const measure = measureNumber(point.beat)
        const rendersRow =
          point.kind === "grid" ||
          compareBeats(snapBeatToSelectedSplit(point.beat, props.selectedSplit), point.beat) === 0
        const nextBeat = addBeats(point.beat, beatFromTicks(1, props.selectedSplit))
        const rowHeight = Math.max(
          1,
          props.audioMicrosToY(beatToAudioMicros(props.timing, nextBeat)) -
            props.audioMicrosToY(point.audioMicros),
        )
        return (
          <div
            className={`timeline__row ${measure === null ? "" : "is-measure"}`}
            data-region={region === undefined ? undefined : "automatic"}
            {...(rendersRow
              ? {
                  "data-row-beat-denominator": point.beat.denominator,
                  "data-row-beat-numerator": point.beat.numerator,
                }
              : {})}
            key={beatKey(point.beat)}
            style={{
              transform: `translateY(${props.audioMicrosToY(point.audioMicros)}px)`,
              blockSize: rowHeight,
            }}
          >
            {props.lanes.map((lane) => {
              const readOnly = props.readOnly || (props.regionsReadOnly && region !== undefined)
              const laneNotes = notesByLane.get(lane) ?? []
              let low = 0
              let high = laneNotes.length
              while (low < high) {
                const middle = Math.floor((low + high) / 2)
                const note = laneNotes[middle]
                if (note !== undefined && compareBeats(note.at, point.beat) <= 0) low = middle + 1
                else high = middle
              }
              const demand = laneNotes[low - 1]
              const occupied =
                demand !== undefined &&
                compareBeats(addBeats(demand.at, demand.hold), point.beat) >= 0
              return (
                <div className="timeline__lane" key={laneLabels[lane]}>
                  {rendersRow && !occupied ? (
                    <button
                      type="button"
                      aria-label={`Lane ${laneLabels[lane]}, beat ${beatKey(point.beat)}, empty${region === undefined ? "" : `, automatic region ${region.name}`}`}
                      aria-disabled={readOnly || undefined}
                      className="timeline__cell note-empty"
                      data-beat-denominator={point.beat.denominator}
                      data-beat-numerator={point.beat.numerator}
                      data-lane={lane}
                      data-read-only={readOnly || undefined}
                      data-tone={laneTone(lane)}
                    />
                  ) : null}
                </div>
              )
            })}
            {rendersRow || tempo !== undefined ? (
              <button
                type="button"
                className="timeline__timing mono"
                disabled={props.readOnly}
                aria-label={`Beat ${formatBeat(point.beat)}${tempo === undefined ? ", add tempo" : `, ${formatBpm(tempo.micros_per_beat)} BPM`}`}
                onClick={() => props.onOpenTempo(point.beat)}
              >
                <span>
                  {measure === null
                    ? formatBeat(point.beat)
                    : `M${measure} · ${formatBeat(point.beat)}`}
                </span>
                {tempo === undefined ? null : (
                  <strong>{formatBpm(tempo.micros_per_beat)} BPM</strong>
                )}
              </button>
            ) : null}
            {region !== undefined && previousRegion?.id !== region.id ? (
              <span className="timeline__region-label">{region.name} · automatic</span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function TimelineNotes(
  props: TimelineRowsProps & {
    readonly notesByLane: ReadonlyMap<PanelIndex, readonly BeatNote[]>
  },
) {
  const visibleNotesByLane = useMemo(
    () =>
      new Map(
        props.lanes.map((lane) => [
          lane,
          (props.notesByLane.get(lane) ?? []).filter((note) => {
            const head = beatToAudioMicros(props.timing, note.at)
            const tail = beatToAudioMicros(props.timing, addBeats(note.at, note.hold))
            return (
              head <= props.visibleAudioRange.endMicros &&
              tail >= props.visibleAudioRange.startMicros
            )
          }),
        ]),
      ),
    [props.lanes, props.notesByLane, props.timing, props.visibleAudioRange],
  )
  return (
    <div className="timeline__note-layer">
      {props.lanes.map((lane) => (
        <div className="timeline__note-lane" key={laneLabels[lane]}>
          {(visibleNotesByLane.get(lane) ?? []).map((note) => {
            const region = regionAtBeat(props.regions, note.at)
            return (
              <ExactNote
                key={`${beatKey(note.at)}:${lane}`}
                note={note}
                lane={lane}
                timing={props.timing}
                readOnly={props.readOnly || (props.regionsReadOnly && region !== undefined)}
                visibleAudioRange={props.visibleAudioRange}
                runwaySize={props.runwaySize}
                audioMicrosToY={props.audioMicrosToY}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ExactNote(props: {
  readonly note: BeatNote
  readonly lane: PanelIndex
  readonly timing: BeatTiming
  readonly readOnly: boolean
  readonly visibleAudioRange: { readonly startMicros: number; readonly endMicros: number }
  readonly runwaySize: number
  readonly audioMicrosToY: (audioMicros: number) => number
}) {
  const headMicros = beatToAudioMicros(props.timing, props.note.at)
  const tailBeat = addBeats(props.note.at, props.note.hold)
  const tailMicros = beatToAudioMicros(props.timing, tailBeat)
  const hold = compareBeats(props.note.hold, { numerator: 0, denominator: 1 }) > 0
  const geometry = boundedTimelineNoteGeometry({
    headY: props.audioMicrosToY(headMicros),
    tailY: props.audioMicrosToY(tailMicros),
    visibleStartY: props.audioMicrosToY(props.visibleAudioRange.startMicros),
    visibleEndY: props.audioMicrosToY(props.visibleAudioRange.endMicros),
    runwaySize: props.runwaySize,
  })
  if (geometry === null) return null
  const headY = props.audioMicrosToY(headMicros),
    tailY = props.audioMicrosToY(tailMicros)
  const origin = hold ? geometry.insetBlockStart : headY - 17
  const caps = hold ? [headY, tailY] : [headY]
  return (
    <button
      type="button"
      className={`timeline__exact-note ${hold ? "is-hold" : "is-tap"}`}
      aria-label={`Lane ${laneLabels[props.lane]}, exact note at beat ${formatBeat(props.note.at)}${hold ? `, hold tail ${formatBeat(tailBeat)}` : ""}`}
      aria-disabled={props.readOnly || undefined}
      data-beat-denominator={props.note.at.denominator}
      data-beat-numerator={props.note.at.numerator}
      data-tail-denominator={tailBeat.denominator}
      data-tail-numerator={tailBeat.numerator}
      data-lane={props.lane}
      data-tone={laneTone(props.lane)}
      style={{
        insetBlockStart: `${origin}px`,
        blockSize: `${hold ? geometry.blockSize : 34}px`,
      }}
    >
      {caps.map((y, index) =>
        y < props.audioMicrosToY(props.visibleAudioRange.startMicros) ||
        y > props.audioMicrosToY(props.visibleAudioRange.endMicros) ? null : (
          <svg
            className="timeline__note-glyph"
            key={index === 0 ? "head" : "tail"}
            viewBox="-1.1 -1.1 2.2 2.2"
            aria-hidden="true"
            style={{ top: y - origin }}
          >
            <path d={noteGlyphPath(props.lane)} />
          </svg>
        ),
      )}
    </button>
  )
}

function regionAtBeat(regions: readonly TimelineRegion[], beat: Beat): TimelineRegion | undefined {
  return regions.find(
    (region) => compareBeats(region.start, beat) <= 0 && compareBeats(beat, region.end) < 0,
  )
}

function measureNumber(beat: Beat): number | null {
  const divisor = beat.denominator * 4
  return beat.numerator % divisor === 0 ? beat.numerator / divisor + 1 : null
}

function formatBpm(value: { readonly numerator: number; readonly denominator: number }): string {
  return (60_000_000 / (value.numerator / value.denominator)).toFixed(3).replace(/\.?0+$/, "")
}
