import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { z } from "zod"

import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { GenerationProject } from "../../shared/generation-projects.ts"
import type { GenerationRules } from "../../shared/generation-rules.ts"
import { type NativeMusic, NativeMusicSchema } from "../../shared/native.ts"
import { type UcsMode, UcsModeSchema } from "../../shared/project.ts"
import {
  type NativeRuleGeneration,
  NativeRuleGenerationSchema,
} from "../../shared/project-commands.ts"
import { assertUcsCellExclusive, UcsCellConflictError } from "../../shared/ucs-cells.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import {
  type BeatProjectNativeCapability,
  projectBeatGenerationNative,
} from "./beat-project-adapter.ts"
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
    project: GenerationProjectV2 | GenerationProject,
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ): Promise<NativeRuleGeneration> {
    await this.#requireReady()
    const parsedSeed = SeedSchema.parse(seed)
    const nativeProject =
      project.schema_version === 1
        ? project
        : requireNativeProject(projectBeatGenerationNative(project))
    return withPrivateWorkspace(async (root) => {
      const rules = resolve(root, "rules.json")
      const music = resolve(root, "music.json")
      const contract = resolve(root, "contract.json")
      await Promise.all([
        writeFile(rules, JSON.stringify(nativeProject.generation_rules)),
        writeFile(music, JSON.stringify(materializeNativeMusic(nativeProject, audio))),
        writeFile(contract, JSON.stringify(nativeProject.evaluation_contract)),
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
          nativeProject.mode,
          "--seed",
          parsedSeed,
          "--format",
          "json",
        ],
        signal,
      )
      return parseNativeRuleGeneration(encoded, nativeProject.mode, nativeProject.generation_rules)
    })
  }

  async #requireReady(): Promise<void> {
    if (!(await this.readiness()).ready)
      throw new StudioError(503, "native_unavailable", "Native rule generator is unavailable")
  }
}

function requireNativeProject(
  projection: ReturnType<typeof projectBeatGenerationNative>,
): GenerationProject {
  if (projection.kind === "unsupported") throw nativeCapabilityError(projection.capability)
  return projection.project
}

function nativeCapabilityError(capability: BeatProjectNativeCapability): StudioError {
  switch (capability.code) {
    case "native_duration_unresolved":
      return new StudioError(
        422,
        capability.code,
        "Native generation requires a concrete output extent",
      )
    case "native_grid_unsupported":
      return new StudioError(
        422,
        capability.code,
        `Exact native generation requires at least ${capability.required_tpb} ticks per beat; limit ${capability.limit}`,
      )
    case "native_limit_unsupported":
      return new StudioError(
        422,
        capability.code,
        `Exact native ${capability.field} ${capability.value} exceeds limit ${capability.limit}`,
      )
    case "native_evaluation_extent_unsupported":
      return new StudioError(422, capability.code, capability.message)
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
  rules: GenerationRules,
): NativeRuleGeneration {
  const decoded: unknown = JSON.parse(encoded)
  const nativeMode = NativeModeEnvelopeSchema.parse(decoded).mode
  if (nativeMode !== expectedMode)
    throw new StudioError(
      500,
      "native_mode_mismatch",
      `Native rule generator returned mode ${nativeMode} for ${expectedMode} project`,
    )
  const generation = NativeRuleGenerationSchema.parse(decoded)
  const allowedMask = expectedMode === "Single" ? 0x001f : 0x03ff
  if (generation.chart.notes.some((note) => (note.panel_mask & ~allowedMask) !== 0))
    throw new StudioError(
      500,
      "native_mask_mismatch",
      `Native rule generator returned lanes outside ${expectedMode} mode`,
    )
  if (rules.schema_version === 1) return generation
  validateHybridGeneration(generation, rules)
  return generation
}

function validateHybridGeneration(
  generation: NativeRuleGeneration,
  rules: Extract<GenerationRules, { readonly schema_version: 2 }>,
): void {
  if (!generation.ucs_validation.valid)
    throw new StudioError(
      500,
      "native_ucs_invalid",
      "Native hybrid generation did not pass UCS validation",
    )
  try {
    assertUcsCellExclusive(generation.chart)
  } catch (error) {
    if (!(error instanceof UcsCellConflictError)) throw error
    throw new StudioError(500, "native_ucs_invalid", error.message)
  }
  const fixed = new Set(rules.fixed_notes.map(noteKey))
  const returned = new Set(generation.chart.notes.map(noteKey))
  if (rules.fixed_notes.some((note) => !returned.has(noteKey(note))))
    throw new StudioError(
      500,
      "native_fixed_note_mismatch",
      "Native hybrid generation omitted a fixed note",
    )
  for (const note of generation.chart.notes) {
    if (fixed.has(noteKey(note))) continue
    const region = rules.regions.find(
      ({ rules: cycle }) => cycle.start_tick <= note.tick && note.tick < cycle.end_tick,
    )
    if (
      region === undefined ||
      (note.tick - region.rules.start_tick) % region.rules.step_ticks !== 0 ||
      note.tick + note.hold_ticks >= region.rules.end_tick
    )
      throw new StudioError(
        500,
        "native_region_mismatch",
        "Native hybrid generation returned a note outside its automatic region",
      )
  }
}

function noteKey(note: {
  readonly tick: number
  readonly panel_mask: number
  readonly hold_ticks: number
}): string {
  return `${note.tick}:${note.panel_mask}:${note.hold_ticks}`
}

async function withPrivateWorkspace<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), "pump-project-rules-"))
  try {
    return await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
