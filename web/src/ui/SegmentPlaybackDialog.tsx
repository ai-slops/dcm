import { Play, RotateCcw } from "lucide-react"
import { useState } from "react"

import { ActionDialog } from "./ActionDialog.tsx"
import { Button } from "./primitives.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

type SegmentPlaybackDialogProps = {
  readonly playback: AudioPlaybackController
  readonly onClose: () => void
}

function initialRange(playback: AudioPlaybackController): readonly [number, number] {
  const snapshot = playback.getSnapshot()
  const duration = snapshot.durationSeconds
  if (duration === null || duration <= 0) return [0, 0]
  if (snapshot.segment !== null) {
    return [snapshot.segment.startSeconds, snapshot.segment.endSeconds]
  }
  const currentSeconds = Math.min(snapshot.audioMicros / 1_000_000, duration)
  const startSeconds = currentSeconds >= duration ? Math.max(0, duration - 10) : currentSeconds
  return [startSeconds, Math.min(duration, startSeconds + 10)]
}

export function SegmentPlaybackDialog({ playback, onClose }: SegmentPlaybackDialogProps) {
  const snapshot = playback.getSnapshot()
  const [initialStart, initialEnd] = initialRange(playback)
  const [start, setStart] = useState(String(initialStart))
  const [end, setEnd] = useState(String(initialEnd))
  const [loop, setLoop] = useState(snapshot.segment?.loop ?? false)
  const [error, setError] = useState("")
  const duration = snapshot.durationSeconds

  async function playSelectedSegment(): Promise<void> {
    setError("")
    try {
      await playback.playSegment(Number(start), Number(end), loop)
      onClose()
    } catch (caught) {
      if (caught instanceof RangeError) {
        setError(caught.message)
        return
      }
      throw caught
    }
  }

  return (
    <ActionDialog open busy={false} title="Play audio segment" onClose={onClose}>
      <form
        className="action-dialog__body segment-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void playSelectedSegment()
        }}
      >
        <p className="status-copy">
          Choose an interval in actual audio seconds. Playback still projects through the existing
          chart offset and tempo map for the timeline and playfield.
        </p>
        <p className="mono segment-dialog__duration">
          {duration === null ? "Audio duration unavailable" : `Duration ${duration.toFixed(3)} s`}
        </p>
        <div className="segment-dialog__range">
          <label className="file-action">
            Start (audio seconds)
            <input
              aria-label="Segment start in audio seconds"
              type="number"
              required
              min="0"
              max={duration ?? undefined}
              step="any"
              value={start}
              disabled={duration === null}
              onChange={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <label className="file-action">
            End (audio seconds)
            <input
              aria-label="Segment end in audio seconds"
              type="number"
              required
              min="0"
              max={duration ?? undefined}
              step="any"
              value={end}
              disabled={duration === null}
              onChange={(event) => setEnd(event.currentTarget.value)}
            />
          </label>
        </div>
        <label className="segment-dialog__loop">
          <input
            type="checkbox"
            checked={loop}
            disabled={duration === null}
            onChange={(event) => setLoop(event.currentTarget.checked)}
          />
          Loop selected segment
        </label>
        {error === "" ? null : (
          <p className="operation-result operation-result--error" role="alert">
            {error}
          </p>
        )}
        <div className="segment-dialog__actions">
          <Button
            type="button"
            variant="ghost"
            icon={<RotateCcw size={15} />}
            disabled={snapshot.segment === null}
            onClick={() => {
              playback.clearSegment()
              onClose()
            }}
          >
            Clear segment
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={<Play size={15} />}
            disabled={duration === null}
          >
            Play segment
          </Button>
        </div>
      </form>
    </ActionDialog>
  )
}
