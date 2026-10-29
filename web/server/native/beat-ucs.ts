import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { z } from "zod"

import {
  type BeatChartCore,
  BeatChartCoreSchema,
  BeatNoteSchema,
  BeatSchema,
} from "../../shared/beat.ts"
import { resolveChartOutputTiming } from "../../shared/beat-output.ts"
import { FractionSchema, NonNegativeIntegerSchema } from "../../shared/native.ts"
import { UcsModeSchema } from "../../shared/project.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import { nativeExecutable } from "./paths.ts"
import { ProcessPool } from "./process.ts"

const NativeBeatUcsSchema = z
  .strictObject({
    mode: UcsModeSchema,
    offset_micros: z.number().int().safe(),
    tempo: z
      .array(z.strictObject({ at: BeatSchema, micros_per_beat: FractionSchema }).readonly())
      .readonly(),
    grid_sections: z
      .array(
        z
          .strictObject({
            at: BeatSchema,
            rows_per_measure: NonNegativeIntegerSchema.min(1).max(512),
          })
          .readonly(),
      )
      .readonly(),
    duration: BeatSchema,
    notes: z.array(BeatNoteSchema).readonly(),
    audio_sha256: z.array(NonNegativeIntegerSchema.max(255)).length(32).readonly(),
    reference_accents: z.array(BeatSchema).readonly(),
  })
  .readonly()

export class NativeBeatUcsService {
  readonly #pump: string
  readonly #pool = new ProcessPool(2, 32, true)

  constructor(repoRoot: string) {
    this.#pump = nativeExecutable(repoRoot)
  }

  import(bytes: Uint8Array, audio: AudioRecord): Promise<BeatChartCore> {
    return withWorkspace(async (root) => {
      const input = resolve(root, "input.ucs")
      const audioPath = resolve(root, `music.${audio.format}`)
      await Promise.all([writeFile(input, bytes), writeFile(audioPath, audio.bytes)])
      const output = await this.#pool.run(this.#pump, [
        "chart",
        "import-ucs-beats",
        input,
        "--audio",
        audioPath,
        "--format",
        "json",
      ])
      return parseBeatUcsImport(output)
    })
  }

  export(chart: BeatChartCore, signal?: AbortSignal): Promise<Uint8Array> {
    const source = beatUcsDocumentFor(chart)
    return withWorkspace(async (root) => {
      const input = resolve(root, "chart.json")
      const output = resolve(root, "chart.ucs")
      await writeFile(
        input,
        JSON.stringify({
          mode: source.mode,
          offset_micros: source.offset_micros,
          tempo: source.tempo,
          grid_sections: source.grid_sections,
          duration: source.duration,
          notes: source.notes,
          audio_sha256: Array.from({ length: 32 }, () => 0),
          reference_accents: source.reference_accents,
        }),
      )
      await this.#pool.run(
        this.#pump,
        ["chart", "export-ucs-beats", input, "--out", output, "--format", "json"],
        signal,
      )
      return readFile(output)
    })
  }
}

export function beatUcsDocumentFor(chart: BeatChartCore): z.infer<typeof NativeBeatUcsSchema> {
  const source = BeatChartCoreSchema.parse(chart)
  const outputTiming = resolveChartOutputTiming(source)
  if (outputTiming === null || outputTiming.duration === null)
    throw new StudioError(
      422,
      "empty_auto_extent",
      "Automatic UCS extent requires at least one note",
    )
  return NativeBeatUcsSchema.parse({
    mode: source.mode,
    offset_micros: outputTiming.offset_micros,
    tempo: outputTiming.tempo,
    grid_sections: outputTiming.grid_sections,
    duration: outputTiming.duration,
    notes: source.notes,
    audio_sha256: Array.from({ length: 32 }, () => 0),
    reference_accents: outputTiming.reference_accents,
  })
}

export function parseBeatUcsImport(output: string): BeatChartCore {
  const imported = NativeBeatUcsSchema.parse(JSON.parse(output))
  return BeatChartCoreSchema.parse({
    mode: imported.mode,
    timing: {
      schema_version: 1,
      offset_micros: imported.offset_micros,
      tempo: imported.tempo,
      grid_sections: imported.grid_sections,
      duration: imported.duration,
      reference_accents: imported.reference_accents,
    },
    notes: imported.notes,
  })
}

async function withWorkspace<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), "pump-beat-ucs-"))
  try {
    return await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
