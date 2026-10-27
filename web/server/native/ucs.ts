import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import {
  ChartDocumentSchema,
  type StudioProjectV1,
  type UcsChart,
  UcsChartSchema,
  type UcsMode,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import { ProcessPool } from "./process.ts"
import { nativeExecutable } from "./service.ts"

export class NativeUcsService {
  readonly #pump: string
  readonly #pool = new ProcessPool(2, 32, true)

  constructor(repoRoot: string) {
    this.#pump = nativeExecutable(repoRoot)
  }

  export(project: StudioProjectV1, mode: UcsMode, signal?: AbortSignal): Promise<Uint8Array> {
    const canonical = ChartDocumentSchema.parse(project)
    if (canonical.ucs_mode !== mode)
      throw new StudioError(409, "chart_mode_immutable", "UCS export mode must match the chart")
    return withUcsWorkspace(async (root) => {
      const chart = resolve(root, "chart.json")
      const music = resolve(root, "music.json")
      const output = resolve(root, "chart.ucs")
      await Promise.all([
        writeFile(chart, JSON.stringify(canonical.chart)),
        writeFile(music, JSON.stringify(canonical.music)),
      ])
      await this.#pool.run(
        this.#pump,
        [
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
        ],
        signal,
      )
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
