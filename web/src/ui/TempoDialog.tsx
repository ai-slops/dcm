import { type RefObject, useEffect, useState } from "react"

import type { Beat, BeatTiming } from "../../shared/index.ts"
import { compareBeats } from "../../shared/index.ts"
import { formatBeat } from "../domain/beat-timeline.ts"
import {
  addTempoMarker,
  bpmInputValue,
  removeTempoMarker,
  updateTempoMarker,
} from "../domain/beat-timing-inputs.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { Button, Field } from "./primitives.tsx"

type TempoDialogProps = {
  readonly at: Beat
  readonly timing: BeatTiming
  readonly focusFallbackRef: RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly onTimingChange: (timing: BeatTiming) => void
}

export function TempoDialog(props: TempoDialogProps) {
  const markerIndex = props.timing.tempo.findIndex(
    (marker) => compareBeats(marker.at, props.at) === 0,
  )
  const marker = markerIndex < 0 ? undefined : props.timing.tempo[markerIndex]
  const [bpm, setBpm] = useState(marker === undefined ? "" : bpmInputValue(marker.micros_per_beat))
  const [error, setError] = useState("")
  useEffect(() => {
    setBpm(marker === undefined ? "" : bpmInputValue(marker.micros_per_beat))
    setError("")
  }, [marker])

  function commit(kind: "add" | "update" | "remove"): void {
    const result =
      kind === "add"
        ? addTempoMarker(props.timing, formatBeat(props.at), bpm)
        : kind === "update"
          ? updateTempoMarker(props.timing, markerIndex, formatBeat(props.at), bpm)
          : removeTempoMarker(props.timing, markerIndex)
    if (result.kind === "error") {
      setError(result.message)
      return
    }
    try {
      props.onTimingChange(result.timing)
      props.onClose()
    } catch (caught) {
      if (caught instanceof Error) {
        setError(caught.message)
        return
      }
      throw caught
    }
  }

  return (
    <ActionDialog
      open
      busy={false}
      title={`Tempo at beat ${formatBeat(props.at)}`}
      focusFallbackRef={props.focusFallbackRef}
      onClose={props.onClose}
    >
      <form
        className="action-dialog__body tempo-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          commit(marker === undefined ? "add" : "update")
        }}
      >
        <p className="status-copy">
          {marker === undefined
            ? "Add a tempo change at this exact beat."
            : "Update this tempo marker."}
        </p>
        <Field label="BPM">
          <input
            className="mono"
            inputMode="decimal"
            value={bpm}
            onChange={(event) => setBpm(event.currentTarget.value)}
          />
        </Field>
        {error === "" ? null : (
          <p className="operation-result operation-result--error" role="alert">
            {error}
          </p>
        )}
        <div className="tempo-dialog__actions">
          {markerIndex <= 0 ? null : (
            <Button type="button" variant="danger" onClick={() => commit("remove")}>
              Remove
            </Button>
          )}
          <Button type="submit" variant="primary">
            {marker === undefined ? "Add tempo" : "Update tempo"}
          </Button>
        </div>
      </form>
    </ActionDialog>
  )
}
