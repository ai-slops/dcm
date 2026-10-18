import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  type CurrentDocument,
  EvalContractSchema,
  NativeMusicSchema,
  RevisionSchema,
  StudioProjectV1Schema,
} from "../shared/index.ts"

export type DemoState = {
  readonly document: CurrentDocument
  readonly audio: Uint8Array
}

export async function loadDemo(repoRoot: string): Promise<DemoState> {
  const music = NativeMusicSchema.parse(
    JSON.parse(await readFile(resolve(repoRoot, "examples/feedback/music.json"), "utf8")),
  )
  const evaluationContract = EvalContractSchema.parse(
    JSON.parse(await readFile(resolve(repoRoot, "examples/feedback/contract.json"), "utf8")),
  )
  const audio = createDemoWave()
  return {
    document: {
      revision: RevisionSchema.parse(0),
      project: StudioProjectV1Schema.parse({
        schema_version: 1,
        title: "PUMP Studio Demo",
        artist: "PUMP",
        music,
        chart: {
          ticks_per_beat: 4,
          span_ticks: 32,
          notes: [
            { tick: 0, panel_mask: 1, hold_ticks: 4 },
            { tick: 8, panel_mask: 2, hold_ticks: 4 },
            { tick: 16, panel_mask: 4, hold_ticks: 4 },
            { tick: 24, panel_mask: 8, hold_ticks: 4 },
          ],
        },
        evaluation_contract: evaluationContract,
        audio_asset: { format: "wav", byte_length: audio.byteLength },
      }),
    },
    audio,
  }
}

function createDemoWave(): Uint8Array {
  const sampleRate = 8_000
  const samples = sampleRate * 4
  const wave = Buffer.alloc(44 + samples * 2)
  wave.write("RIFF", 0)
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write("WAVEfmt ", 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * 2, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write("data", 36)
  wave.writeUInt32LE(samples * 2, 40)
  for (const time of [
    100_000, 600_000, 1_100_000, 1_600_000, 2_100_000, 2_500_000, 2_900_000, 3_300_000,
  ]) {
    const start = (time * sampleRate) / 1_000_000
    for (let offset = 0; offset < 80; offset += 1) {
      wave.writeInt16LE(offset % 8 < 4 ? 4_000 : -4_000, 44 + (start + offset) * 2)
    }
  }
  return wave
}
