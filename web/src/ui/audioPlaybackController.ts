import type { BeatChartDocument, BeatTiming } from "../../shared/index.ts"
import { audioMicrosToBeatPosition, beatPositionToAudioMicros } from "../domain/beat-timing.ts"
import {
  boundedAudioSeconds,
  canControlPlayback,
  initialPlaybackSnapshot,
  type PlaybackSnapshot,
  validatedPlaybackSegment,
} from "./audio-playback-state.ts"
import {
  type AudioPlaybackEnvironment,
  browserAudioPlaybackEnvironment,
  clearPlaybackMediaHandlers,
  type PlaybackMedia,
} from "./audioPlaybackEnvironment.ts"

export class AudioPlaybackController {
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): PlaybackSnapshot => this.snapshot

  private readonly listeners = new Set<() => void>()
  private snapshot = initialPlaybackSnapshot
  private audio: PlaybackMedia | null = null
  private objectUrl: string | null = null
  private frame = 0
  private loadGeneration = 0
  private timing: BeatTiming

  constructor(
    project: BeatChartDocument,
    private readonly environment: AudioPlaybackEnvironment = browserAudioPlaybackEnvironment,
  ) {
    this.timing = project.timing
  }

  setTiming(timing: BeatTiming): void {
    this.timing = timing
    if (this.audio !== null) this.publishClock(this.audio.currentTime * 1_000_000)
  }

  load(hasAudio: boolean): void {
    this.unload()
    if (!hasAudio) return
    const generation = this.loadGeneration
    this.publish({ ...this.snapshot, status: "loading" })
    void this.environment
      .loadAudio()
      .then((blob) => {
        if (generation !== this.loadGeneration) return
        const objectUrl = this.environment.createObjectUrl(blob)
        const audio = this.environment.createAudio(objectUrl)
        this.objectUrl = objectUrl
        this.audio = audio
        audio.preload = "auto"
        audio.loop = this.snapshot.loop
        audio.playbackRate = this.snapshot.rate
        audio.volume = this.snapshot.volume
        audio.onloadedmetadata = () => this.publishDuration(audio)
        audio.oncanplay = () => {
          this.publishDuration(audio)
          if (this.snapshot.status === "loading")
            this.publish({ ...this.snapshot, status: "ready", error: null })
        }
        audio.onplay = () => {
          this.publish({ ...this.snapshot, status: "playing", error: null })
          this.startClock()
        }
        audio.onpause = () => {
          this.stopClock()
          if (!audio.ended && this.snapshot.status === "playing")
            this.publishClock(audio.currentTime * 1_000_000, "paused")
        }
        audio.onended = () => this.handleEnded(audio)
        audio.ontimeupdate = () => !audio.paused && this.applySegmentBoundary(audio)
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
    if (this.audio !== null) {
      clearPlaybackMediaHandlers(this.audio)
      this.audio.pause()
    }
    this.audio = null
    if (this.objectUrl !== null) this.environment.revokeObjectUrl(this.objectUrl)
    this.objectUrl = null
    this.publish({
      ...initialPlaybackSnapshot,
      loop: this.snapshot.loop,
      rate: this.snapshot.rate,
      volume: this.snapshot.volume,
    })
  }

  async toggle(): Promise<void> {
    const audio = this.audio
    if (audio === null) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    const segment = this.snapshot.segment
    if (
      segment !== null &&
      (audio.currentTime < segment.startSeconds || audio.currentTime >= segment.endSeconds)
    ) {
      audio.currentTime = segment.startSeconds
      this.publishClock(audio.currentTime * 1_000_000, "paused")
    }
    await this.playMedia(audio)
  }

  pause(): void {
    this.audio?.pause()
  }

  stop(): void {
    this.clearSegment()
    const audio = this.audio
    if (audio === null) return
    audio.pause()
    audio.currentTime = boundedAudioSeconds(
      audio,
      Math.max(0, beatPositionToAudioMicros(this.timing, 0)),
    )
    this.publishClock(audio.currentTime * 1_000_000, "ready")
  }

  seekBeatPosition(beat: number): void {
    this.clearSegment()
    if (!canControlPlayback(this.snapshot.status)) return
    const audio = this.audio
    if (audio === null) return
    const duration = this.timing.duration
    const maximum =
      duration === null ? Number.POSITIVE_INFINITY : duration.numerator / duration.denominator
    const bounded = Math.min(Math.max(beat, 0), maximum)
    audio.currentTime = boundedAudioSeconds(
      audio,
      Math.max(0, beatPositionToAudioMicros(this.timing, bounded)),
    )
    this.publishClock(audio.currentTime * 1_000_000, audio.paused ? "paused" : "playing")
  }

  async playSegment(startSeconds: number, endSeconds: number, loop: boolean): Promise<void> {
    const audio = this.audio
    if (audio === null) throw new RangeError("Audio is not ready for segment playback.")
    const segment = validatedPlaybackSegment(startSeconds, endSeconds, loop, audio.duration)
    audio.loop = false
    audio.currentTime = segment.startSeconds
    this.publish({ ...this.snapshot, segment })
    this.publishClock(audio.currentTime * 1_000_000)
    await this.playMedia(audio)
  }

  clearSegment(): void {
    if (this.snapshot.segment === null) return
    if (this.audio !== null) this.audio.loop = this.snapshot.loop
    this.publish({ ...this.snapshot, segment: null })
  }

  setLoop(loop: boolean): void {
    if (this.audio !== null) this.audio.loop = this.snapshot.segment === null && loop
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
      const audio = this.audio
      if (audio === null) return
      if (!this.applySegmentBoundary(audio)) this.publishClock(audio.currentTime * 1_000_000)
      if (!audio.paused) this.frame = this.environment.requestFrame(update)
    }
    this.frame = this.environment.requestFrame(update)
  }

  private stopClock(): void {
    this.environment.cancelFrame(this.frame)
    this.frame = 0
  }

  private applySegmentBoundary(audio: PlaybackMedia): boolean {
    const segment = this.snapshot.segment
    if (segment === null || audio.currentTime < segment.endSeconds) return false
    if (segment.loop) {
      audio.currentTime = segment.startSeconds
      this.publishClock(audio.currentTime * 1_000_000, "playing")
      if (audio.paused) void this.playMedia(audio)
      return true
    }
    audio.currentTime = segment.endSeconds
    audio.pause()
    this.stopClock()
    this.publishClock(audio.currentTime * 1_000_000, "paused")
    return true
  }

  private handleEnded(audio: PlaybackMedia): void {
    this.stopClock()
    if (!this.applySegmentBoundary(audio)) this.publishClock(audio.currentTime * 1_000_000, "ended")
  }

  private async playMedia(audio: PlaybackMedia): Promise<void> {
    try {
      await audio.play()
    } catch (error: unknown) {
      if (audio !== this.audio) return
      if (error instanceof Error) {
        this.fail(`Playback could not start: ${error.message}`)
        return
      }
      throw error
    }
  }

  private publishDuration(audio: PlaybackMedia): void {
    this.publish({
      ...this.snapshot,
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : null,
    })
  }

  private publishClock(audioMicros: number, status = this.snapshot.status): void {
    this.publish({
      ...this.snapshot,
      status,
      audioMicros,
      chartBeat: audioMicrosToBeatPosition(this.timing, audioMicros),
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
