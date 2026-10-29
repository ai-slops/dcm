import type { Beat, BeatNote, BeatTiming, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import type { MobileTab } from "./MobileTabs.tsx"
import { Preview } from "./StudioPanels.tsx"
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
  readonly onRowsPerMeasureChange: (at: Beat, rowsPerMeasure: number) => void
}

export function CenterStudio(props: CenterStudioProps) {
  const panel = props.tab === "preview" ? "preview" : "editor"
  return (
    <section
      className={`center-studio mobile-${props.tab}`}
      id={`${panel}-panel`}
      role="tabpanel"
      aria-labelledby={`${panel}-tab`}
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
        onRowsPerMeasureChange={props.onRowsPerMeasureChange}
      />
      <Preview
        notes={props.notes}
        timing={props.timing}
        mode={props.mode}
        playback={props.playback}
      />
    </section>
  )
}
