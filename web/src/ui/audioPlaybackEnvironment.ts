import { studioApi } from "../api/client.ts"

export interface PlaybackMedia {
  currentTime: number
  readonly duration: number
  readonly ended: boolean
  loop: boolean
  readonly paused: boolean
  playbackRate: number
  preload: string
  volume: number
  oncanplay: ((event: Event) => void) | null
  onended: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onloadedmetadata: ((event: Event) => void) | null
  onpause: ((event: Event) => void) | null
  onplay: ((event: Event) => void) | null
  ontimeupdate: ((event: Event) => void) | null
  pause(): void
  play(): Promise<void>
}

export type AudioPlaybackEnvironment = {
  readonly cancelFrame: (frame: number) => void
  readonly createAudio: (url: string) => PlaybackMedia
  readonly createObjectUrl: (blob: Blob) => string
  readonly loadAudio: () => Promise<Blob>
  readonly requestFrame: (callback: () => void) => number
  readonly revokeObjectUrl: (url: string) => void
}

export const browserAudioPlaybackEnvironment: AudioPlaybackEnvironment = {
  cancelFrame: (frame) => cancelAnimationFrame(frame),
  createAudio: (url) => new Audio(url),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  loadAudio: () => studioApi.audio(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
}

export function clearPlaybackMediaHandlers(audio: PlaybackMedia): void {
  audio.oncanplay = null
  audio.onended = null
  audio.onerror = null
  audio.onloadedmetadata = null
  audio.onpause = null
  audio.onplay = null
  audio.ontimeupdate = null
}
