import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import {
  type StudioProjectV1,
  type UcsChart,
  UcsChartSchema,
  type UcsMode,
} from "../../shared/index.ts"
import type { AudioRecord } from "../store.ts"
import { ProcessPool } from "./process.ts"
import { nativeExecutable } from "./service.ts"

export class NativeUcsService {
  readonly #pump: string
  readonly #pool = new ProcessPool(2, 32, true)

  constructor(repoRoot: string) {
    this.#pump = nativeExecutable(repoRoot)
  }

  export(project: StudioProjectV1, mode: UcsMode): Promise<Uint8Array> {
    return withUcsWorkspace(async (root) => {
      const chart = resolve(root, "chart.json")
      const music = resolve(root, "music.json")
      const output = resolve(root, "chart.ucs")
      await Promise.all([
        writeFile(chart, JSON.stringify(project.chart)),
        writeFile(music, JSON.stringify(project.music)),
      ])
      await this.#pool.run(this.#pump, [
        "chart",
        "export-ucs",
        chart,
        "--music",
        music,
        "--mode",
        mode,
        "--out",
        output,
        "--format",
        "json",
      ])
      return readFile(output)
    })
  }

  import(bytes: Uint8Array, audio: AudioRecord): Promise<UcsChart> {
    return withUcsWorkspace(async (root) => {
      const chart = resolve(root, "input.ucs")
      const audioPath = resolve(root, `music.${audio.format}`)
      await Promise.all([writeFile(chart, bytes), writeFile(audioPath, audio.bytes)])
      const output = await this.#pool.run(this.#pump, [
        "chart",
        "import-ucs",
        chart,
        "--audio",
        audioPath,
        "--format",
        "json",
      ])
      return UcsChartSchema.parse(JSON.parse(output))
    })
  }
}

async function withUcsWorkspace<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), "pump-ucs-"))
  try {
    return await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
