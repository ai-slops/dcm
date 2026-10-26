import { z } from "zod"

export const ProviderApiSchema = z.enum(["chat", "responses"])
export const ProviderModelSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          !/\s/.test(value) &&
          [...value].every(
            (character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127,
          ),
      ),
    name: z.string().min(1).max(256),
    api: ProviderApiSchema,
    context: z.number().int().safe().positive().optional(),
    output: z.number().int().safe().positive().optional(),
  })
  .readonly()

export const AgentProviderStatusSchema = z
  .object({
    configured: z.boolean(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    source: z.enum(["off", "dim", "standalone"]).optional(),
    api: ProviderApiSchema.nullable().optional(),
    runtime: z.string().optional(),
    message: z.string().max(1024).optional(),
    models: z.array(ProviderModelSchema).max(128).readonly().optional(),
  })
  .readonly()

export type ProviderApi = z.infer<typeof ProviderApiSchema>
export type ProviderModel = z.infer<typeof ProviderModelSchema>
export type AgentProviderStatus = z.infer<typeof AgentProviderStatusSchema>
