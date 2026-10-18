import type { Context } from "hono"
import { z } from "zod"

import { StudioError } from "./errors.ts"

export const JSON_LIMIT = 8 * 1024 * 1024
export const AUDIO_LIMIT = 32 * 1024 * 1024

export async function parseJson<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const length = Number(context.req.header("content-length") ?? 0)
  if (length > JSON_LIMIT) throw new StudioError(413, "body_too_large", "JSON body exceeds 8 MiB")
  return schema.parse(await context.req.json())
}

export async function parseMultipart(context: Context): Promise<FormData> {
  const length = Number(context.req.header("content-length") ?? 0)
  if (length > AUDIO_LIMIT + 1024 * 1024) {
    throw new StudioError(413, "body_too_large", "Multipart body exceeds its limit")
  }
  return context.req.raw.formData()
}

export function requiredFile(form: FormData, name: string): File {
  const value = form.get(name)
  if (!(value instanceof File)) throw new StudioError(400, "multipart_file", `Missing ${name} file`)
  if (value.size > AUDIO_LIMIT)
    throw new StudioError(413, "audio_too_large", "Audio exceeds 32 MiB")
  return value
}

export function requiredRevision(form: FormData): number {
  const value = form.get("base_revision")
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new StudioError(400, "base_revision", "Multipart base_revision must be a decimal integer")
  }
  return z.number().int().nonnegative().safe().parse(Number(value))
}

export function audioFormat(file: File): "wav" | "ogg" | "mp3" {
  const extension = file.name.split(".").at(-1)?.toLowerCase()
  const format = z.enum(["wav", "ogg", "mp3"]).safeParse(extension)
  if (!format.success) throw new StudioError(400, "audio_format", "Audio must be WAV, OGG, or MP3")
  return format.data
}
