import { createHash } from "node:crypto"
import { compareBeats } from "../../shared/beat.ts"
import { type BeatChartDocument, BeatChartDocumentSchema } from "../../shared/beat-projects.ts"
import type { UcsMode } from "../../shared/index.ts"
import type { AudioBinding } from "../../shared/library.ts"
import type { NewSong } from "../../shared/library-commands.ts"

export function newSongProject(
  input: NewSong,
  audio: AudioBinding,
  template: BeatChartDocument,
): BeatChartDocument {
  const duration = { numerator: input.beats, denominator: 1 } as const
  const tempo = microsPerBeat(input.bpm)
  return BeatChartDocumentSchema.parse({
    schema_version: 1,
    title: input.title,
    artist: input.artist,
    chart_artist: null,
    mode: input.mode,
    timing: {
      schema_version: 1,
      duration,
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 192 }],
      offset_micros: 0,
      tempo: [{ at: { numerator: 0, denominator: 1 }, micros_per_beat: tempo }],
      reference_accents: [],
    },
    notes: [],
    audio_sha256: audio.sha256,
    evaluation_contract: compatibleEvaluationContract(template, duration),
    audio_asset: { format: audio.format, byte_length: audio.byte_length },
  })
}

export function emptyChartProject(source: BeatChartDocument, mode: UcsMode): BeatChartDocument {
  return BeatChartDocumentSchema.parse({
    ...source,
    notes: [],
    mode,
  })
}

export function withNativeIdentity(
  project: BeatChartDocument,
  title: string,
  artist: string,
): BeatChartDocument {
  return BeatChartDocumentSchema.parse({
    ...project,
    title,
    artist,
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

export function compatibleEvaluationContract(
  template: BeatChartDocument,
  duration: { readonly numerator: number; readonly denominator: number },
) {
  const contract = template.evaluation_contract
  return {
    ...contract,
    difficulty: {
      ...contract.difficulty,
      local_windows: contract.difficulty.local_windows.filter(
        (window) => compareBeats(window.width, duration) <= 0,
      ),
    },
    intents: contract.intents.filter((intent) => {
      if (intent.kind.kind === "reference_accents")
        return compareBeats(intent.kind.tolerance, duration) <= 0
      if (intent.kind.kind === "negative_space") return compareBeats(intent.kind.end, duration) <= 0
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
