import type { Beat, BeatNote, BeatTiming, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import type { MobileTab } from "./MobileTabs.tsx"
import { Timeline } from "./Timeline.tsx"
import type { TimelineRegion } from "./TimelineRows.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

type CenterStudioProps = {
  readonly tab: MobileTab
  readonly notes: readonly BeatNote[]
  readonly timing: BeatTiming
  readonly mode: UcsMode
  readonly playback: AudioPlaybackController
  readonly automaticRegions?: readonly TimelineRegion[]
  readonly onToggleTap: (at: Beat, lane: PanelIndex) => void
  readonly onPlaceHold: (head: Beat, tail: Beat, lane: PanelIndex) => void
  readonly onTimingChange: (timing: BeatTiming) => void
}

export function CenterStudio(props: CenterStudioProps) {
  return (
    <section
      className={`center-studio mobile-${props.tab}`}
      id="editor-panel"
      role="tabpanel"
      aria-labelledby="editor-tab"
    >
      <Timeline
        notes={props.notes}
        timing={props.timing}
        mode={props.mode}
        playback={props.playback}
        {...(props.automaticRegions === undefined
          ? {}
          : { automaticRegions: props.automaticRegions })}
        onToggleTap={props.onToggleTap}
        onPlaceHold={props.onPlaceHold}
        onTimingChange={props.onTimingChange}
      />
    </section>
  )
}
