import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { z } from "zod"

import type { GenerationProject } from "../../shared/generation-projects.ts"
import { type NativeMusic, NativeMusicSchema } from "../../shared/native.ts"
import { type UcsMode, UcsModeSchema } from "../../shared/project.ts"
import {
  type NativeRuleGeneration,
  NativeRuleGenerationSchema,
} from "../../shared/project-commands.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import { ProcessPool } from "./process.ts"
import { nativeExecutable } from "./service.ts"

const SeedSchema = z.string().regex(/^[0-9a-f]{64}$/)
const NativeModeEnvelopeSchema = z.object({ mode: UcsModeSchema })

export type ProjectNativeReadiness = {
  readonly ready: boolean
  readonly message: string
}

export class ProjectNativeService {
  readonly #pump: string
  readonly #pool = new ProcessPool(2)
  #readiness: ProjectNativeReadiness | undefined

  constructor(repoRoot: string) {
    this.#pump = nativeExecutable(repoRoot)
  }

  async readiness(): Promise<ProjectNativeReadiness> {
    if (this.#readiness !== undefined) return this.#readiness
    try {
      await access(this.#pump)
      this.#readiness = { ready: true, message: "Native rule generator ready" }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.#readiness = {
        ready: false,
        message: "Native rule generator unavailable. Project editing remains available.",
      }
    }
    return this.#readiness
  }

  async generate(
    project: GenerationProject,
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ): Promise<NativeRuleGeneration> {
    await this.#requireReady()
    const parsedSeed = SeedSchema.parse(seed)
    return withPrivateWorkspace(async (root) => {
      const rules = resolve(root, "rules.json")
      const music = resolve(root, "music.json")
      const contract = resolve(root, "contract.json")
      await Promise.all([
        writeFile(rules, JSON.stringify(project.generation_rules)),
        writeFile(music, JSON.stringify(materializeNativeMusic(project, audio))),
        writeFile(contract, JSON.stringify(project.evaluation_contract)),
      ])
      const encoded = await this.#pool.run(
        this.#pump,
        [
          "chart",
          "generate-rules",
          rules,
          "--music",
          music,
          "--contract",
          contract,
          "--mode",
          project.mode,
          "--seed",
          parsedSeed,
          "--format",
          "json",
        ],
        signal,
      )
      return parseNativeRuleGeneration(encoded, project.mode)
    })
  }

  async #requireReady(): Promise<void> {
    if (!(await this.readiness()).ready)
      throw new StudioError(503, "native_unavailable", "Native rule generator is unavailable")
  }
}

export function materializeNativeMusic(
  project: GenerationProject,
  audio: AudioRecord,
): NativeMusic {
  return NativeMusicSchema.parse({
    ...project.timing,
    audio_sha256: Array.from(Buffer.from(audio.digest, "hex")),
  })
}

export function parseNativeRuleGeneration(
  encoded: string,
  expectedMode: UcsMode,
): NativeRuleGeneration {
  const decoded: unknown = JSON.parse(encoded)
  const nativeMode = NativeModeEnvelopeSchema.parse(decoded).mode
  if (nativeMode !== expectedMode)
    throw new StudioError(
      500,
      "native_mode_mismatch",
      `Native rule generator returned mode ${nativeMode} for ${expectedMode} project`,
    )
  return NativeRuleGenerationSchema.parse(decoded)
}

async function withPrivateWorkspace<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), "pump-project-rules-"))
  try {
    return await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
