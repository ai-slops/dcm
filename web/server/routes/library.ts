import { createHash } from "node:crypto"
import { ArchiveIdSchema, SongIdSchema } from "../../shared/library.ts"
import {
  DownloadArchiveSchema,
  ImportChartSchema,
  LibraryCommandSchema,
  NewSongSchema,
} from "../../shared/library-commands.ts"
import { StudioError } from "../errors.ts"
import {
  AUDIO_LIMIT,
  audioFormat,
  jsonPart,
  parseJson,
  parseMultipart,
  requiredArchive,
  requiredFile,
  UCS_LIMIT,
} from "../http.ts"
import { searchUcsCatalog } from "../library/catalog.ts"
import type { NativeBeatUcsService } from "../native/beat-ucs.ts"
import type { AudioRecord } from "../store.ts"
import type { Services, StudioApp } from "../types.ts"

export function registerLibraryRoutes(
  app: StudioApp,
  services: Services,
  ucs: NativeBeatUcsService,
): void {
  app.get("/api/v1/library", (context) => context.json(services.store.library()))
  app.get("/api/v1/library/catalog", async (context) =>
    context.json(await searchUcsCatalog(context.req.query("query") ?? "", context.req.raw.signal)),
  )
  app.post("/api/v1/library/actions", async (context) => {
    const command = await parseJson(context, LibraryCommandSchema)
    return context.json(
      command.type === "import_archive"
        ? await services.archives.import(command)
        : await services.library.command(command),
    )
  })

  app.post("/api/v1/library/songs", async (context) => {
    const form = await parseMultipart(context)
    onlyFields(form, ["input", "audio"])
    const input = jsonPart(form, "input", NewSongSchema)
    const value = form.get("audio")
    const audio = value === null ? audioRecord(new Uint8Array(0), "wav") : await audioFile(value)
    return context.json(await services.library.createSong(input, audio))
  })

  app.put("/api/v1/library/songs/:id/audio", async (context) => {
    const form = await parseMultipart(context)
    onlyFields(form, ["input", "audio"])
    const input = jsonPart(form, "input", AudioInputSchema)
    const audio = await audioFile(requiredFile(form, "audio"))
    return context.json(
      await services.library.rebindAudio(
        SongIdSchema.parse(context.req.param("id")),
        input.library_revision,
        input.base_revision,
        audio,
      ),
    )
  })

  app.post("/api/v1/library/songs/:id/charts", async (context) => {
    const form = await parseMultipart(context)
    onlyFields(form, ["input", "chart"])
    const input = jsonPart(form, "input", ImportChartSchema)
    const file = form.get("chart")
    if (!(file instanceof File)) throw new StudioError(400, "ucs_file", "Choose a UCS file")
    if (file.size > UCS_LIMIT) throw new StudioError(413, "ucs_too_large", "UCS exceeds 16 MiB")
    const songId = SongIdSchema.parse(context.req.param("id"))
    const audio = await services.store.songAudio(songId)
    const imported = await ucs.import(new Uint8Array(await file.arrayBuffer()), audio)
    return context.json(await services.library.importChart(songId, input, imported))
  })

  app.get("/api/v1/library/charts/:id", (context) =>
    context.json(services.store.chartDocument(ChartId.parse(context.req.param("id")))),
  )
  app.get("/api/v1/library/songs/:id/audio", async (context) =>
    audioResponse(await services.store.songAudio(SongIdSchema.parse(context.req.param("id")))),
  )

  app.get("/api/v1/library/songs/:id/export", async (context) => {
    const bytes = await services.archives.exportSong(
      SongIdSchema.parse(context.req.param("id")),
      context.req.raw.signal,
    )
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="song.zip"',
        "content-length": String(bytes.byteLength),
        "x-pump-certification": "none",
      },
    })
  })
  app.post("/api/v1/library/archives", async (context) => {
    const form = await parseMultipart(context)
    onlyFields(form, ["library_revision", "file"])
    const revision = decimalPart(form, "library_revision")
    const file = requiredArchive(form, "file")
    return context.json(await services.archives.stage(revision, file))
  })
  app.post("/api/v1/library/archives/download", async (context) => {
    const input = await parseJson(context, DownloadArchiveSchema)
    return context.json(await services.archives.download(input, context.req.raw.signal))
  })
  app.get("/api/v1/library/archives/:id/file", async (context) =>
    archiveResponse(
      await services.store.archiveFile(ArchiveIdSchema.parse(context.req.param("id"))),
    ),
  )
}

import { z } from "zod"
import { RevisionSchema } from "../../shared/index.ts"
import { ChartIdSchema as ChartId, LibraryRevisionSchema } from "../../shared/library.ts"

const AudioInputSchema = z
  .strictObject({
    library_revision: LibraryRevisionSchema,
    base_revision: RevisionSchema.optional(),
  })
  .readonly()

function onlyFields(form: FormData, allowed: readonly string[]): void {
  for (const name of form.keys())
    if (!allowed.includes(name) || form.getAll(name).length !== 1)
      throw new StudioError(
        400,
        "multipart_field",
        `Multipart accepts one each of: ${allowed.join(", ")}`,
      )
}

async function audioFile(value: FormDataEntryValue): Promise<AudioRecord> {
  if (!(value instanceof File)) throw new StudioError(400, "audio_file", "Audio must be a file")
  if (value.size > AUDIO_LIMIT)
    throw new StudioError(413, "audio_too_large", "Audio exceeds 32 MiB")
  const bytes = new Uint8Array(await value.arrayBuffer())
  return audioRecord(bytes, audioFormat(value))
}

function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return { bytes, format, digest: createHash("sha256").update(bytes).digest("hex") }
}

function audioResponse(audio: AudioRecord): Response {
  return new Response(Uint8Array.from(audio.bytes).buffer, {
    headers: {
      "content-type": audio.format === "wav" ? "audio/wav" : `audio/${audio.format}`,
      "content-length": String(audio.bytes.byteLength),
      etag: `"${audio.digest}"`,
      "cache-control": "private, no-store",
    },
  })
}

function archiveResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
    },
  })
}

function decimalPart(form: FormData, name: string): number {
  const value = form.get(name)
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new StudioError(400, name, `${name} must be a decimal integer`)
  return LibraryRevisionSchema.parse(Number(value))
}
