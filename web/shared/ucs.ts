import { z } from "zod"

import { RevisionSchema } from "./api.ts"
import { NativeChartSchema, NativeMusicSchema } from "./native.ts"
import { UcsModeSchema } from "./project.ts"

export const UcsExportRequestSchema = z
  .strictObject({
    base_revision: RevisionSchema,
    mode: UcsModeSchema,
  })
  .readonly()

export const UcsChartSchema = z
  .strictObject({
    mode: UcsModeSchema,
    chart: NativeChartSchema,
    music: NativeMusicSchema,
  })
  .readonly()

export type UcsExportRequest = z.infer<typeof UcsExportRequestSchema>
export type UcsChart = z.infer<typeof UcsChartSchema>
