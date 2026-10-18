import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve } from "node:path"

import { zipSync } from "fflate"
import { z } from "zod"

import {
  type EvaluationResponse,
  EvaluationResponseSchema,
  NativeAssessmentSchema,
  type NativeChart,
  NativeChartSchema,
  NativeMusicSchema,
  type StudioProjectV1,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import { type BundleCompileInput, resolveBundle } from "./bundle-cache.ts"
import { ProcessPool } from "./process.ts"

const GeneratedSchema = z.strictObject({
  candidate_id: z.array(z.number().int().min(0).max(255)).length(32),
  chart: NativeChartSchema,
  program_sha256: z.array(z.number().int().min(0).max(255)).length(32),
  request_sha256: z.array(z.number().int().min(0).max(255)).length(32),
  base_ratio: z.object({ numerator: z.number(), denominator: z.number() }),
  history_conditioned_ratio: z.object({ numerator: z.number(), denominator: z.number() }),
  eligible_weight: z.number(),
  allow_repeat_fallback: z.boolean(),
})

export type NativeReadiness = { readonly ready: boolean; readonly message: string }

export class NativeService {
  readonly #pump: string
  readonly #bundleRoot: string
  readonly #pool = new ProcessPool(2)
  readonly #bundleFlights = new Map<string, Promise<string>>()
  #readiness: NativeReadiness | undefined

  constructor(
    readonly repoRoot: string,
    readonly dataRoot: string,
  ) {
    this.#pump = nativeExecutable(repoRoot)
    this.#bundleRoot = resolve(dataRoot, "native")
  }

  async readiness(): Promise<NativeReadiness> {
    if (this.#readiness !== undefined) return this.#readiness
    try {
      await Promise.all([
        access(this.#pump),
        access(resolve(this.repoRoot, "dist/chart-author.component.wasm")),
        access(resolve(this.repoRoot, "dist/chart-runtime.component.wasm")),
      ])
      this.#readiness = { ready: true, message: "Native runtime ready" }
    } catch {
      this.#readiness = {
        ready: false,
        message: "Native runtime unavailable. Editing remains available.",
      }
    }
    return this.#readiness
  }

  async evaluate(project: StudioProjectV1, signal?: AbortSignal): Promise<EvaluationResponse> {
    await this.#requireReady()
    return withWorkspace("pump-evaluate-", async (root) => {
      const chart = resolve(root, "chart.json")
      const music = resolve(root, "music.json")
      const contract = resolve(root, "contract.json")
      await writeInputs(project, { chart, music, contract })
      const output = await this.#pool.run(
        this.#pump,
        ["chart", "evaluate", chart, "--music", music, "--contract", contract, "--format", "json"],
        signal,
      )
      const assessment = NativeAssessmentSchema.parse(JSON.parse(output))
      return EvaluationResponseSchema.parse({
        summary: {
          label: "finite_model",
          accepted: assessment.accepted,
          uncalibrated: assessment.difficulty.uncalibrated,
          rejection_count: assessment.rejections.length,
        },
        raw_native: assessment,
      })
    })
  }

  async generate(
    project: StudioProjectV1,
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ): Promise<NativeChart> {
    await this.#requireReady()
    const bundle = await this.#ensureBundle(project, audio, signal)
    const output = await this.#pool.run(
      this.#pump,
      ["chart", "generate", bundle, "--seed", seed, "--format", "json"],
      signal,
    )
    return GeneratedSchema.parse(JSON.parse(output)).chart
  }

  async export(
    project: StudioProjectV1,
    audio: AudioRecord,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    await this.#requireReady()
    return withWorkspace("pump-export-", async (root) => {
      const chart = resolve(root, "chart.json")
      const music = resolve(root, "music.json")
      const contract = resolve(root, "contract.json")
      const audioPath = resolve(root, `source.${audio.format}`)
      const output = resolve(root, "export")
      await writeInputs(project, { chart, music, contract })
      await writeFile(audioPath, audio.bytes)
      await this.#pool.run(
        this.#pump,
        [
          "chart",
          "export-edited-ssc",
          chart,
          "--music",
          music,
          "--audio",
          audioPath,
          "--out",
          output,
          "--title",
          project.title,
          "--artist",
          project.artist,
          "--format",
          "json",
        ],
        signal,
      )
      const names = ["chart.ssc", `music.${audio.format}`, "edited-export.json"] as const
      const entries: Record<string, Uint8Array> = {
        "project.json": new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`),
      }
      for (const name of names) entries[name] = await readFile(resolve(output, name))
      return zipSync(entries, { level: 6 })
    })
  }

  async #ensureBundle(
    project: StudioProjectV1,
    audio: AudioRecord,
    signal?: AbortSignal,
  ): Promise<string> {
    const author = resolve(this.repoRoot, "dist/chart-author.component.wasm")
    const runtime = resolve(this.repoRoot, "dist/chart-runtime.component.wasm")
    const demoMusic = NativeMusicSchema.parse(
      JSON.parse(await readFile(resolve(this.repoRoot, "examples/feedback/music.json"), "utf8")),
    )
    if (JSON.stringify(project.music) !== JSON.stringify(demoMusic)) {
      throw new StudioError(
        409,
        "profile_mismatch",
        "Current music does not match the native demo profile",
      )
    }
    const [cliBytes, authorBytes, runtimeBytes] = await Promise.all([
      readFile(this.#pump),
      readFile(author),
      readFile(runtime),
    ])
    return resolveBundle({
      root: this.#bundleRoot,
      flights: this.#bundleFlights,
      project,
      audio,
      compilerArtifacts: { cli: cliBytes, author: authorBytes, runtime: runtimeBytes },
      signal,
      compile: (input) => this.#compileBundle(input),
    })
  }

  async #compileBundle(input: BundleCompileInput): Promise<void> {
    await withWorkspace("pump-compile-", async (root) => {
      const audioPath = resolve(root, `music.${input.audio.format}`)
      const musicPath = resolve(root, "music.json")
      const contractPath = resolve(root, "contract.json")
      await Promise.all([
        writeFile(audioPath, input.audio.bytes),
        writeFile(musicPath, JSON.stringify(input.project.music)),
        writeFile(contractPath, JSON.stringify(input.project.evaluation_contract)),
      ])
      await this.#pool.run(
        this.#pump,
        [
          "chart",
          "compile",
          resolve(this.repoRoot, "dist/chart-author.component.wasm"),
          "--runtime",
          resolve(this.repoRoot, "dist/chart-runtime.component.wasm"),
          "--music",
          musicPath,
          "--contract",
          contractPath,
          "--audio",
          audioPath,
          "--out",
          input.bundle,
          "--format",
          "json",
        ],
        input.signal,
      )
    })
  }

  async #requireReady(): Promise<void> {
    if (!(await this.readiness()).ready) {
      throw new StudioError(503, "native_unavailable", "Native runtime is unavailable")
    }
  }
}

async function writeInputs(
  project: StudioProjectV1,
  paths: { readonly chart: string; readonly music: string; readonly contract: string },
): Promise<void> {
  await Promise.all([
    writeFile(paths.chart, JSON.stringify(project.chart)),
    writeFile(paths.music, JSON.stringify(project.music)),
    writeFile(paths.contract, JSON.stringify(project.evaluation_contract)),
  ])
}

async function withWorkspace<T>(
  prefix: string,
  operation: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), prefix))
  try {
    return await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export function exportFilename(project: StudioProjectV1): string {
  return `${basename(project.title.replaceAll(/[^A-Za-z0-9._-]/g, "-") || "pump-chart")}.zip`
}

export function nativeExecutable(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolve(repoRoot, "dist", platform === "win32" ? "pump.exe" : "pump")
}
