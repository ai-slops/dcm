import { useEffect, useRef, useSyncExternalStore } from "react"

import type { NativeMusic, StudioProjectV1 } from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { chartTickAtAudioMicros } from "../domain/playback.ts"
import { tickToAudioMicros } from "../domain/timing.ts"

export type PlaybackStatus =
  | "no-audio"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error"

export type PlaybackSnapshot = {
  readonly status: PlaybackStatus
  readonly audioMicros: number
  readonly chartTick: number | null
  readonly error: string | null
  readonly loop: boolean
  readonly rate: number
  readonly volume: number
}

const initialSnapshot: PlaybackSnapshot = {
  status: "no-audio",
  audioMicros: 0,
  chartTick: null,
  error: null,
  loop: false,
  rate: 1,
  volume: 1,
}

export class AudioPlaybackController {
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): PlaybackSnapshot => this.snapshot

  private readonly listeners = new Set<() => void>()
  private snapshot = initialSnapshot
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private frame = 0
  private loadGeneration = 0
  private music: NativeMusic
  private spanTicks: number

  constructor(project: StudioProjectV1) {
    this.music = project.music
    this.spanTicks = project.chart.span_ticks
  }

  setTiming(music: NativeMusic, spanTicks: number): void {
    this.music = music
    this.spanTicks = spanTicks
    if (this.audio !== null) this.publishClock(this.audio.currentTime * 1_000_000)
  }

  load(hasAudio: boolean): void {
    this.unload()
    if (!hasAudio) {
      this.publish({ ...this.snapshot, status: "no-audio", error: null })
      return
    }
    const generation = this.loadGeneration
    this.publish({ ...this.snapshot, status: "loading", error: null })
    void studioApi
      .audio()
      .then((blob) => {
        if (generation !== this.loadGeneration) return
        const objectUrl = URL.createObjectURL(blob)
        const audio = new Audio(objectUrl)
        this.objectUrl = objectUrl
        this.audio = audio
        audio.preload = "auto"
        audio.loop = this.snapshot.loop
        audio.playbackRate = this.snapshot.rate
        audio.volume = this.snapshot.volume
        audio.oncanplay = () => {
          if (this.snapshot.status === "loading") {
            this.publish({ ...this.snapshot, status: "ready", error: null })
          }
        }
        audio.onplay = () => {
          this.publish({ ...this.snapshot, status: "playing", error: null })
          this.startClock()
        }
        audio.onpause = () => {
          this.stopClock()
          if (!audio.ended && this.snapshot.status === "playing") {
            this.publishClock(audio.currentTime * 1_000_000, "paused")
          }
        }
        audio.onended = () => {
          this.stopClock()
          this.publishClock(audio.currentTime * 1_000_000, "ended")
        }
        audio.onerror = () => this.fail("Audio playback failed. Re-import the audio and try again.")
      })
      .catch((error: unknown) => {
        if (generation !== this.loadGeneration) return
        if (error instanceof Error) {
          this.fail(`Audio loading failed: ${error.message}`)
          return
        }
        throw error
      })
  }

  unload(): void {
    this.loadGeneration += 1
    this.stopClock()
    const audio = this.audio
    if (audio !== null) {
      audio.pause()
      audio.oncanplay = null
      audio.onplay = null
      audio.onpause = null
      audio.onended = null
      audio.onerror = null
    }
    this.audio = null
    if (this.objectUrl !== null) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }

  async toggle(): Promise<void> {
    const audio = this.audio
    if (audio === null) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.fail(`Playback could not start: ${error.message}`)
        return
      }
      throw error
    }
  }

  pause(): void {
    this.audio?.pause()
  }

  stop(): void {
    const audio = this.audio
    if (audio === null) return
    audio.pause()
    const audioMicros = Math.max(0, tickToAudioMicros(this.music, 0))
    audio.currentTime = audioMicros / 1_000_000
    this.publishClock(audioMicros, "ready")
  }

  seek(tick: number): void {
    switch (this.snapshot.status) {
      case "no-audio":
      case "loading":
      case "error":
        return
      case "ready":
      case "playing":
      case "paused":
      case "ended":
        break
      default: {
        const unreachable: never = this.snapshot.status
        throw new TypeError(`Unexpected playback state: ${String(unreachable)}`)
      }
    }
    const audio = this.audio
    if (audio === null) return
    const boundedTick = Math.min(Math.max(tick, 0), this.spanTicks)
    const audioMicros = Math.max(0, tickToAudioMicros(this.music, boundedTick))
    audio.currentTime = audioMicros / 1_000_000
    this.publishClock(audioMicros, audio.paused ? "paused" : "playing")
  }

  setLoop(loop: boolean): void {
    if (this.audio !== null) this.audio.loop = loop
    this.publish({ ...this.snapshot, loop })
  }

  setRate(rate: number): void {
    if (this.audio !== null) this.audio.playbackRate = rate
    this.publish({ ...this.snapshot, rate })
  }

  setVolume(volume: number): void {
    if (this.audio !== null) this.audio.volume = volume
    this.publish({ ...this.snapshot, volume })
  }

  private startClock(): void {
    this.stopClock()
    const update = () => {
      if (this.audio === null) return
      this.publishClock(this.audio.currentTime * 1_000_000)
      this.frame = requestAnimationFrame(update)
    }
    this.frame = requestAnimationFrame(update)
  }

  private stopClock(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private publishClock(audioMicros: number, status = this.snapshot.status): void {
    this.publish({
      ...this.snapshot,
      status,
      audioMicros,
      chartTick: chartTickAtAudioMicros(this.music, audioMicros),
    })
  }

  private fail(error: string): void {
    this.stopClock()
    this.publish({ ...this.snapshot, status: "error", error })
  }

  private publish(snapshot: PlaybackSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

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

export function showsPlaybackClock(status: PlaybackStatus): boolean {
  return status === "playing" || status === "paused"
}
