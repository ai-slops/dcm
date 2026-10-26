import { createHash } from "node:crypto"

import { ApiRoutes, StudioProjectV1Schema, UcsExportRequestSchema } from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import {
  AUDIO_LIMIT,
  audioFormat,
  parseJson,
  parseMultipart,
  requiredRevision,
  UCS_LIMIT,
} from "../http.ts"
import { exportFilename } from "../native/service.ts"
import { NativeUcsService } from "../native/ucs.ts"
import type { Services, StudioApp } from "../types.ts"
import { currentAtRevision } from "./native.ts"

export function registerUcsRoutes(app: StudioApp, services: Services): void {
  const native = new NativeUcsService(services.config.repoRoot)
  app.post(ApiRoutes.ucsExport, async (context) => {
    const request = await parseJson(context, UcsExportRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    const bytes = await native.export(document.project, request.mode)
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(document.project).replace(/\.zip$/, ".ucs")}"`,
        "content-length": String(bytes.byteLength),
        "x-pump-certification": "none",
      },
    })
  })

  app.post(ApiRoutes.ucsImport, async (context) => {
    const form = await parseMultipart(context)
    for (const name of form.keys()) {
      if (!["base_revision", "chart", "audio"].includes(name) || form.getAll(name).length !== 1) {
        throw new StudioError(
          400,
          "multipart_field",
          "UCS import accepts one revision, chart, and optional audio",
        )
      }
    }
    const baseRevision = requiredRevision(form)
    const current = currentAtRevision(services, baseRevision)
    const chart = form.get("chart")
    if (!(chart instanceof File)) throw new StudioError(400, "ucs_file", "Choose a UCS file")
    if (chart.size > UCS_LIMIT) throw new StudioError(413, "ucs_too_large", "UCS exceeds 16 MiB")
    const audioFile = form.get("audio")
    let audio = services.store.audio()
    if (audioFile !== null) {
      if (!(audioFile instanceof File))
        throw new StudioError(400, "audio_file", "Audio must be a file")
      if (audioFile.size > AUDIO_LIMIT)
        throw new StudioError(413, "audio_too_large", "Audio exceeds 32 MiB")
      const bytes = new Uint8Array(await audioFile.arrayBuffer())
      audio = {
        bytes,
        format: audioFormat(audioFile),
        digest: createHash("sha256").update(bytes).digest("hex"),
      }
    }
    const imported = await native.import(new Uint8Array(await chart.arrayBuffer()), audio)
    const parsed = StudioProjectV1Schema.safeParse({
      ...current.project,
      chart: imported.chart,
      music: imported.music,
      audio_asset: { format: audio.format, byte_length: audio.bytes.byteLength },
      ucs_mode: imported.mode,
    })
    if (!parsed.success) {
      throw new StudioError(
        422,
        "ucs_project_incompatible",
        `UCS cannot replace this project: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      )
    }
    return context.json(await services.store.replace(baseRevision, parsed.data, audio.bytes))
  })
}
