import { createHash } from "node:crypto"

import { PutDocumentRequestSchema, StudioProjectV1Schema } from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import { audioFormat, parseJson, parseMultipart, requiredFile, requiredRevision } from "../http.ts"
import type { Services, StudioApp } from "../types.ts"

export function registerDocumentRoutes(app: StudioApp, services: Services): void {
  app.get("/api/v1/audio", (context) => audioResponse(context.req.header("range"), services))

  app.put("/api/v1/document", async (context) => {
    const request = await parseJson(context, PutDocumentRequestSchema)
    return context.json(await services.store.save(request.base_revision, request.project))
  })

  app.put("/api/v1/audio", async (context) => {
    const form = await parseMultipart(context)
    const baseRevision = requiredRevision(form)
    const file = requiredFile(form, "audio")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const format = audioFormat(file)
    const digest = [...createHash("sha256").update(bytes).digest()]
    const current = services.store.document()
    const project = StudioProjectV1Schema.parse({
      ...current.project,
      music: { ...current.project.music, audio_sha256: digest },
      audio_asset: { format, byte_length: bytes.byteLength },
    })
    return context.json(await services.store.replace(baseRevision, project, bytes))
  })

  app.post("/api/v1/imports", async (context) => {
    const form = await parseMultipart(context)
    const baseRevision = requiredRevision(form)
    const file = requiredFile(form, "audio")
    const projectValue = form.get("project")
    if (typeof projectValue !== "string") {
      throw new StudioError(400, "project_part", "Project must be a JSON text part")
    }
    const project = StudioProjectV1Schema.parse(JSON.parse(projectValue))
    if (audioFormat(file) !== project.audio_asset.format) {
      throw new StudioError(400, "audio_format", "Audio extension differs from project metadata")
    }
    return context.json(
      await services.store.replace(baseRevision, project, new Uint8Array(await file.arrayBuffer())),
    )
  })
}

function audioResponse(range: string | undefined, services: Services): Response {
  const audio = services.store.audio()
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": audio.format === "wav" ? "audio/wav" : `audio/${audio.format}`,
    etag: `"${audio.digest}"`,
  })
  if (range === undefined) {
    headers.set("content-length", String(audio.bytes.byteLength))
    return new Response(Uint8Array.from(audio.bytes).buffer, { headers })
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (match === null || (match[1] === "" && match[2] === ""))
    return rangeFailure(audio.bytes.byteLength)
  const requestedStart = match[1] === "" ? undefined : Number(match[1])
  const requestedEnd = match[2] === "" ? undefined : Number(match[2])
  const start = requestedStart ?? Math.max(0, audio.bytes.byteLength - (requestedEnd ?? 0))
  const end =
    requestedStart === undefined
      ? audio.bytes.byteLength - 1
      : Math.min(requestedEnd ?? audio.bytes.byteLength - 1, audio.bytes.byteLength - 1)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= audio.bytes.byteLength
  ) {
    return rangeFailure(audio.bytes.byteLength)
  }
  const body = audio.bytes.slice(start, end + 1)
  headers.set("content-length", String(body.byteLength))
  headers.set("content-range", `bytes ${start}-${end}/${audio.bytes.byteLength}`)
  return new Response(Uint8Array.from(body).buffer, { status: 206, headers })
}

function rangeFailure(length: number): Response {
  return new Response(null, { status: 416, headers: { "content-range": `bytes */${length}` } })
}
