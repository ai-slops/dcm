import { createHash } from "node:crypto"

import { type StudioProjectV1, StudioProjectV1Schema, type UcsMode } from "../../shared/index.ts"
import type { AudioBinding } from "../../shared/library.ts"
import type { NewSong } from "../../shared/library-commands.ts"

export function newSongProject(
  input: NewSong,
  audio: AudioBinding,
  template: StudioProjectV1,
): StudioProjectV1 {
  const duration = input.beats * 48
  const tempo = microsPerBeat(input.bpm)
  return StudioProjectV1Schema.parse({
    schema_version: 1,
    title: nativeMetadata(input.title),
    artist: nativeMetadata(input.artist),
    music: {
      duration_ticks: duration,
      ticks_per_beat: 48,
      offset_micros: 0,
      tempo: [{ start_tick: 0, micros_per_beat: tempo }],
      audio_sha256: digestBytes(audio.sha256),
      reference_accents: [],
    },
    chart: { ticks_per_beat: 48, span_ticks: duration, notes: [] },
    evaluation_contract: compatibleContract(template, duration),
    audio_asset: { format: audio.format, byte_length: audio.byte_length },
    ucs_mode: input.mode,
  })
}

export function emptyChartProject(source: StudioProjectV1, mode: UcsMode): StudioProjectV1 {
  return StudioProjectV1Schema.parse({
    ...source,
    chart: { ...source.chart, notes: [] },
    ucs_mode: mode,
  })
}

export function withNativeIdentity(
  project: StudioProjectV1,
  title: string,
  artist: string,
): StudioProjectV1 {
  return StudioProjectV1Schema.parse({
    ...project,
    title: nativeMetadata(title),
    artist: nativeMetadata(artist),
  })
}

export function nativeMetadata(value: string): string {
  const ascii = [...value]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code <= 0x7e ? character : "_"
    })
    .join("")
    .replaceAll("//", "__")
    .trim()
  return (ascii.length === 0 ? "Untitled" : ascii).slice(0, 256)
}

export function bindingFor(bytes: Uint8Array, format: AudioBinding["format"]): AudioBinding {
  return {
    format,
    byte_length: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

function compatibleContract(template: StudioProjectV1, duration: number) {
  const contract = template.evaluation_contract
  return {
    ...contract,
    difficulty: {
      ...contract.difficulty,
      local_windows: contract.difficulty.local_windows.filter(
        (window) => window.width_ticks <= duration,
      ),
    },
    intents: contract.intents.filter((intent) => {
      if (intent.kind.kind === "reference_accents") return intent.kind.tolerance_ticks <= duration
      if (intent.kind.kind === "negative_space") return intent.kind.end_tick <= duration
      return true
    }),
  }
}

function microsPerBeat(bpm: number): { readonly numerator: number; readonly denominator: number } {
  const [integer = "0", fractional = ""] = bpm.toString().split(".")
  const scale = 10 ** fractional.length
  const bpmNumerator = Number(integer) * scale + Number(fractional)
  const numerator = 60_000_000 * scale
  const divisor = gcd(numerator, bpmNumerator)
  return { numerator: numerator / divisor, denominator: bpmNumerator / divisor }
}

function gcd(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend
}

export function digestBytes(hex: string): readonly number[] {
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  )
}
