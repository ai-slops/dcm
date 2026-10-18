import { z } from "zod"

import { EvalContractSchema } from "./evaluation-contract.ts"
import { NativeChartSchema, NativeMusicSchema, NonNegativeIntegerSchema } from "./native.ts"

const SscMetadataSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !value.includes("//") &&
      [...value].every((character) => {
        const code = character.charCodeAt(0)
        return code >= 0x20 && code <= 0x7e
      }),
    { message: "metadata must be printable ASCII without comment fragments" },
  )

export const AudioAssetSchema = z
  .strictObject({
    format: z.enum(["wav", "ogg", "mp3"]),
    byte_length: NonNegativeIntegerSchema,
  })
  .readonly()

export const StudioProjectV1Schema = z
  .strictObject({
    schema_version: z.literal(1),
    title: SscMetadataSchema,
    artist: SscMetadataSchema,
    music: NativeMusicSchema,
    chart: NativeChartSchema,
    evaluation_contract: EvalContractSchema,
    audio_asset: AudioAssetSchema,
  })
  .superRefine((project, context) => {
    if (project.chart.ticks_per_beat !== project.music.ticks_per_beat) {
      context.addIssue({
        code: "custom",
        path: ["chart", "ticks_per_beat"],
        message: "chart and music grids differ",
      })
    }
    if (project.chart.span_ticks !== project.music.duration_ticks) {
      context.addIssue({
        code: "custom",
        path: ["chart", "span_ticks"],
        message: "chart and music spans differ",
      })
    }
    for (const [index, window] of project.evaluation_contract.difficulty.local_windows.entries()) {
      if (window.width_ticks > project.music.duration_ticks) {
        context.addIssue({
          code: "custom",
          path: ["evaluation_contract", "difficulty", "local_windows", index],
          message: "window exceeds music",
        })
      }
    }
    for (const [index, intent] of project.evaluation_contract.intents.entries()) {
      const exceedsMusic =
        (intent.kind.kind === "reference_accents" &&
          intent.kind.tolerance_ticks > project.music.duration_ticks) ||
        (intent.kind.kind === "negative_space" &&
          intent.kind.end_tick > project.music.duration_ticks)
      if (exceedsMusic) {
        context.addIssue({
          code: "custom",
          path: ["evaluation_contract", "intents", index],
          message: "intent exceeds music",
        })
      }
    }
  })
  .readonly()

export type AudioAsset = z.infer<typeof AudioAssetSchema>
export type StudioProjectV1 = z.infer<typeof StudioProjectV1Schema>
