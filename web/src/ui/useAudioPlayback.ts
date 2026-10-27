import { useEffect, useRef, useSyncExternalStore } from "react"

import type { StudioProjectV1 } from "../../shared/index.ts"
import type { PlaybackSnapshot } from "./audio-playback-state.ts"
import { AudioPlaybackController } from "./audioPlaybackController.ts"

export { AudioPlaybackController } from "./audioPlaybackController.ts"
export type { AudioPlaybackEnvironment, PlaybackMedia } from "./audioPlaybackEnvironment.ts"

export function useAudioPlayback(project: StudioProjectV1): AudioPlaybackController {
  const controllerRef = useRef<AudioPlaybackController | null>(null)
  if (controllerRef.current === null) controllerRef.current = new AudioPlaybackController(project)
  const controller = controllerRef.current
  const hasAudio = project.audio_asset.byte_length > 0
  const audioDigest = project.music.audio_sha256.join(",")

  useEffect(
    () => controller.setTiming(project.music, project.chart.span_ticks),
    [controller, project],
  )
  useEffect(() => {
    controller.load(hasAudio && audioDigest !== "")
    return () => controller.unload()
  }, [audioDigest, controller, hasAudio])
  return controller
}

export function usePlaybackSnapshot(controller: AudioPlaybackController): PlaybackSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}
