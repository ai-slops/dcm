import { useEffect, useRef, useSyncExternalStore } from "react"

import type { StudioProjectV1 } from "../../shared/index.ts"
import type { PlaybackSnapshot } from "./audio-playback-state.ts"
import { AudioPlaybackController } from "./audioPlaybackController.ts"
import type { AudioPlaybackEnvironment } from "./audioPlaybackEnvironment.ts"

export { AudioPlaybackController } from "./audioPlaybackController.ts"
export type { AudioPlaybackEnvironment, PlaybackMedia } from "./audioPlaybackEnvironment.ts"

export function useAudioPlayback(project: StudioProjectV1): AudioPlaybackController {
  return useAudioPlaybackSource(project, browserSource)
}

const browserSource = {
  key: "active-studio-audio",
} as const

export function useAudioPlaybackSource(
  project: StudioProjectV1,
  source: {
    readonly key: string
    readonly environment?: AudioPlaybackEnvironment
    readonly hasAudio?: boolean
  },
): AudioPlaybackController {
  const controllerRef = useRef<AudioPlaybackController | null>(null)
  const sourceRef = useRef(source)
  if (controllerRef.current === null || sourceRef.current.key !== source.key) {
    controllerRef.current = new AudioPlaybackController(project, source.environment)
    sourceRef.current = source
  }
  const controller = controllerRef.current
  const hasAudio = source.hasAudio ?? project.audio_asset.byte_length > 0
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
