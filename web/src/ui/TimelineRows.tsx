import { useEffect, useMemo, useRef } from "react"

import type { Beat, BeatNote, BeatTiming } from "../../shared/beat.ts"
import { compareBeats } from "../../shared/beat.ts"
import {
  beatAtTimelineRow,
  beatKey,
  buildBeatCellIndex,
  formatBeat,
  laneTone,
} from "../domain/beat-timeline.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { laneLabels } from "./studio-types.ts"

export type TimelineRegion = {
  readonly id: string
  readonly name: string
  readonly start: Beat
  readonly end: Beat
}

type TimelineRow = { readonly index: number; readonly beat: Beat }

type TimelineRowsProps = {
  readonly rows: readonly TimelineRow[]
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly lanes: readonly PanelIndex[]
  readonly rowSize: number
  readonly cursorRow: number
  readonly cursorLane: PanelIndex
  readonly regions: readonly TimelineRegion[]
  readonly regionsReadOnly: boolean
  readonly readOnly: boolean
  readonly onFocusCell: (row: number, beat: Beat, lane: PanelIndex) => void
  readonly onToggle: (beat: Beat, lane: PanelIndex) => void
  readonly onKeyboardHold: (row: number, lane: PanelIndex) => void
  readonly onMoveCursor: (rowDelta: number, laneDelta: number) => void
}

export function TimelineRows(props: TimelineRowsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const beats = useMemo(() => props.rows.map((row) => row.beat), [props.rows])
  const cells = useMemo(() => buildBeatCellIndex(props.notes, beats), [beats, props.notes])

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      refs.current.get(`${props.cursorRow}:${props.cursorLane}`)?.focus(),
    )
    return () => cancelAnimationFrame(frame)
  }, [props.cursorLane, props.cursorRow])

  return props.rows.map((row, index) => {
    const region = regionAtBeat(props.regions, row.beat)
    const previousBeat = index === 0 ? undefined : props.rows[index - 1]?.beat
    const previousRegion =
      previousBeat === undefined ? undefined : regionAtBeat(props.regions, previousBeat)
    const nextBeat = beatAtTimelineRow(props.timing, row.index + 1)
    const tempo = props.timing.tempo.find(
      (segment) =>
        compareBeats(segment.at, row.beat) >= 0 && compareBeats(segment.at, nextBeat) < 0,
    )
    const measure = measureNumber(row.beat)
    return (
      <div
        className={`timeline__row ${measure === null ? "" : "is-measure"}`}
        data-region={region === undefined ? undefined : "automatic"}
        key={beatKey(row.beat)}
        style={{ transform: `translateY(${index * props.rowSize}px)` }}
      >
        <span className="mono timeline__beat">
          {measure === null ? formatBeat(row.beat) : `M${measure} · ${formatBeat(row.beat)}`}
        </span>
        <span className="mono timeline__tempo">
          {tempo === undefined
            ? null
            : `${compareBeats(tempo.at, row.beat) === 0 ? "" : `${formatBeat(tempo.at)} · `}${formatBpm(tempo.micros_per_beat)} BPM`}
        </span>
        {region !== undefined && previousRegion?.id !== region.id ? (
          <span className="timeline__region-label">{region.name} · automatic</span>
        ) : null}
        {props.lanes.map((lane) => {
          const cell = cells.get(`${beatKey(row.beat)}:${lane}`)
          const readOnly = props.readOnly || (props.regionsReadOnly && region !== undefined)
          const cursor = props.cursorRow === row.index && props.cursorLane === lane
          return (
            <button
              type="button"
              aria-label={`Lane ${laneLabels[lane]}, beat ${beatKey(row.beat)}, ${cell?.state ?? "empty"}${region === undefined ? "" : `, automatic region ${region.name}`}`}
              aria-disabled={readOnly || undefined}
              className={`timeline__cell note-${cell?.state ?? "empty"}`}
              data-beat-denominator={row.beat.denominator}
              data-beat-numerator={row.beat.numerator}
              data-cursor={cursor || undefined}
              data-lane={lane}
              data-read-only={readOnly || undefined}
              data-tone={laneTone(lane)}
              key={laneLabels[lane]}
              ref={(element) => setCellRef(refs.current, row.index, lane, element)}
              tabIndex={cursor ? 0 : -1}
              onFocus={() => props.onFocusCell(row.index, row.beat, lane)}
              onKeyDown={(event) => {
                if (
                  handleCellKey(event.key, event.shiftKey, readOnly, {
                    toggle: () => props.onToggle(row.beat, lane),
                    hold: () => props.onKeyboardHold(row.index, lane),
                    move: props.onMoveCursor,
                  })
                )
                  event.preventDefault()
              }}
            />
          )
        })}
      </div>
    )
  })
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

function setCellRef(
  refs: Map<string, HTMLButtonElement>,
  row: number,
  lane: PanelIndex,
  element: HTMLButtonElement | null,
): void {
  const key = `${row}:${lane}`
  if (element === null) refs.delete(key)
  else refs.set(key, element)
}

function handleCellKey(
  key: string,
  shift: boolean,
  readOnly: boolean,
  actions: {
    readonly toggle: () => void
    readonly hold: () => void
    readonly move: (rowDelta: number, laneDelta: number) => void
  },
): boolean {
  if ((key === "Enter" || key === " ") && !readOnly) actions.toggle()
  else if (key.toLowerCase() === "h" && !readOnly) actions.hold()
  else if (key === "ArrowDown") actions.move(shift ? 4 : 1, 0)
  else if (key === "ArrowUp") actions.move(shift ? -4 : -1, 0)
  else if (key === "ArrowRight") actions.move(0, 1)
  else if (key === "ArrowLeft") actions.move(0, -1)
  else return false
  return true
}
