import type { AutomaticRegionView, NativeChart, NativeMusic, UcsMode } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import type { MobileTab } from "./MobileTabs.tsx"
import { Preview } from "./StudioPanels.tsx"
import { Timeline } from "./Timeline.tsx"
import type { AudioPlaybackController } from "./useAudioPlayback.ts"

type CenterStudioProps = {
  readonly tab: MobileTab
  readonly chart: NativeChart
  readonly music: NativeMusic
  readonly ucsMode: UcsMode
  readonly playback: AudioPlaybackController
  readonly selectedTick: number
  readonly selectedLane: PanelIndex
  readonly quantize: number
  readonly automaticRegions?: readonly AutomaticRegionView[] | undefined
  readonly onQuantize: (ticks: number) => void
  readonly onCell: (tick: number, lane: PanelIndex) => void
  readonly onHold: (startTick: number, endTick: number, lane: PanelIndex) => void
  readonly onSelect: (tick: number, lane: PanelIndex) => void
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
        chart={props.chart}
        music={props.music}
        ucsMode={props.ucsMode}
        playback={props.playback}
        selectedTick={props.selectedTick}
        selectedLane={props.selectedLane}
        quantize={props.quantize}
        automaticRegions={props.automaticRegions}
        onQuantize={props.onQuantize}
        onCell={props.onCell}
        onHold={props.onHold}
        onSelect={props.onSelect}
      />
      <Preview
        chart={props.chart}
        ucsMode={props.ucsMode}
        music={props.music}
        selectedTick={props.selectedTick}
        playback={props.playback}
      />
    </section>
  )
}
