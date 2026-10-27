import { z } from "zod"

import {
  type GenerationProject,
  GenerationProjectSchema,
} from "../../shared/generation-projects.ts"
import {
  HybridRegionIdSchema,
  type HybridRules,
  HybridRulesSchema,
  type WeightedCycleRules,
} from "../../shared/generation-rules.ts"
import type { LibrarySong } from "../../shared/library.ts"
import { NativeChartSchema, STUDIO_MAX_DURATION_TICKS } from "../../shared/native.ts"
import { ChartDocumentSchema, type StudioProjectV1 } from "../../shared/project.ts"
import { GenerationProjectIdSchema } from "../../shared/project-identities.ts"
import { bpmToMicrosPerBeat } from "./timing-inputs.ts"

const PositiveTickInputSchema = z
  .string()
  .regex(/^\d+$/, "Enter a positive whole-number tick count")
  .transform(Number)
  .pipe(z.number().int().positive().max(STUDIO_MAX_DURATION_TICKS))

export type TailExtensionResult =
  | { readonly kind: "success"; readonly project: GenerationProject }
  | { readonly kind: "error"; readonly message: string }

export function parseProjectEditPath(pathname: string): GenerationProject["id"] | null {
  const match = /^\/projects\/([^/]+)\/edit\/?$/.exec(pathname)
  if (match === null) return null
  const parsed = GenerationProjectIdSchema.safeParse(match[1])
  return parsed.success ? parsed.data : null
}

export function convertWeightedCycleToHybrid(
  rules: WeightedCycleRules,
  region: { readonly id: string; readonly name: string },
): HybridRules {
  return HybridRulesSchema.parse({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [],
    regions: [
      {
        id: HybridRegionIdSchema.parse(region.id),
        name: region.name,
        rules: {
          start_tick: rules.start_tick,
          end_tick: rules.end_tick,
          step_ticks: rules.step_ticks,
          pattern: rules.pattern,
        },
      },
    ],
  })
}

export function fixedChartForProject(project: GenerationProject) {
  return NativeChartSchema.parse({
    ticks_per_beat: project.timing.ticks_per_beat,
    span_ticks: project.timing.duration_ticks,
    notes:
      project.generation_rules.schema_version === 2 ? project.generation_rules.fixed_notes : [],
  })
}

export function playbackProjectFor(project: GenerationProject, song: LibrarySong): StudioProjectV1 {
  const audioDigest: number[] = []
  for (let index = 0; index < song.audio.sha256.length; index += 2)
    audioDigest.push(Number.parseInt(song.audio.sha256.slice(index, index + 2), 16))
  return ChartDocumentSchema.parse({
    schema_version: 1,
    title: song.title,
    artist: song.artist,
    music: { ...project.timing, audio_sha256: audioDigest },
    chart: fixedChartForProject(project),
    evaluation_contract: project.evaluation_contract,
    audio_asset: { format: song.audio.format, byte_length: song.audio.byte_length },
    ucs_mode: project.mode,
  })
}

export function replaceHybridRules(
  project: GenerationProject,
  rules: HybridRules,
): GenerationProject {
  return GenerationProjectSchema.parse({ ...project, generation_rules: rules })
}

export function tickIsAutomatic(rules: HybridRules, tick: number): boolean {
  return rules.regions.some(
    (region) => tick >= region.rules.start_tick && tick < region.rules.end_tick,
  )
}

export function extendProjectTail(
  project: GenerationProject,
  input: { readonly additionalTicks: string; readonly tailBpm: string },
): TailExtensionResult {
  const ticks = PositiveTickInputSchema.safeParse(input.additionalTicks)
  if (!ticks.success)
    return {
      kind: "error",
      message: ticks.error.issues[0]?.message ?? "Enter a valid tail length",
    }
  const duration = project.timing.duration_ticks + ticks.data
  if (duration > STUDIO_MAX_DURATION_TICKS)
    return { kind: "error", message: `Project duration cannot exceed ${STUDIO_MAX_DURATION_TICKS}` }

  const tempo = [...project.timing.tempo]
  if (input.tailBpm !== "") {
    const fraction = bpmToMicrosPerBeat(input.tailBpm)
    if (fraction.kind === "error") return fraction
    const active = tempo.at(-1)?.micros_per_beat
    if (
      active === undefined ||
      active.numerator !== fraction.fraction.numerator ||
      active.denominator !== fraction.fraction.denominator
    )
      tempo.push({ start_tick: project.timing.duration_ticks, micros_per_beat: fraction.fraction })
  }

  const parsed = GenerationProjectSchema.safeParse({
    ...project,
    timing: { ...project.timing, duration_ticks: duration, tempo },
  })
  return parsed.success
    ? { kind: "success", project: parsed.data }
    : {
        kind: "error",
        message: parsed.error.issues[0]?.message ?? "The extended project timing is invalid",
      }
}
