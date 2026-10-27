import type { Context, Next } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"

import { StudioError } from "./errors.ts"

export const JSON_LIMIT = 8 * 1024 * 1024
export const AUDIO_LIMIT = 32 * 1024 * 1024
export const UCS_LIMIT = 16 * 1024 * 1024
export const ARCHIVE_LIMIT = 64 * 1024 * 1024
export const MULTIPART_LIMIT = ARCHIVE_LIMIT + 1024 * 1024

const multipartRoutes = new Set([
  "POST /api/v1/imports",
  "POST /api/v1/library/archives",
  "POST /api/v1/library/songs",
  "POST /api/v1/ucs/import",
  "PUT /api/v1/audio",
])

const jsonLimit = bodyLimit({ maxSize: JSON_LIMIT, onError: bodyLimitError })
const multipartLimit = bodyLimit({ maxSize: MULTIPART_LIMIT, onError: bodyLimitError })

export function enforceApiBodyLimit(context: Context, next: Next) {
  const route = `${context.req.method} ${context.req.path}`
  const dynamicMultipart =
    /^PUT \/api\/v1\/library\/songs\/[^/]+\/audio$/.test(route) ||
    /^POST \/api\/v1\/library\/songs\/[^/]+\/charts$/.test(route)
  return (multipartRoutes.has(route) || dynamicMultipart ? multipartLimit : jsonLimit)(
    context,
    next,
  )
}

export async function parseJson<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const length = Number(context.req.header("content-length") ?? 0)
  if (length > JSON_LIMIT) throw new StudioError(413, "body_too_large", "JSON body exceeds 8 MiB")
  const bytes = await limitedBody(context.req.raw, JSON_LIMIT)
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)))
}

export async function parseMultipart(context: Context): Promise<FormData> {
  const length = Number(context.req.header("content-length") ?? 0)
  if (length > MULTIPART_LIMIT) {
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

export function requiredArchive(form: FormData, name: string): File {
  const value = form.get(name)
  if (!(value instanceof File)) throw new StudioError(400, "multipart_file", `Missing ${name} file`)
  if (value.size > ARCHIVE_LIMIT)
    throw new StudioError(413, "archive_too_large", "Archive exceeds 64 MiB")
  return value
}

export function jsonPart<T>(form: FormData, name: string, schema: z.ZodType<T>): T {
  const value = form.get(name)
  if (typeof value !== "string")
    throw new StudioError(400, "multipart_json", `Missing ${name} JSON part`)
  return schema.parse(JSON.parse(value))
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

function bodyLimitError(context: Context): Response {
  return context.json(
    { error: { code: "body_too_large", message: "Request body exceeds its limit" } },
    413,
  )
}

async function limitedBody(request: Request, maximum: number): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw new StudioError(413, "body_too_large", "JSON body exceeds 8 MiB")
    }
    chunks.push(result.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
