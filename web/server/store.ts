import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { resolve } from "node:path"

import {
  type CurrentDocument,
  CurrentDocumentSchema,
  RevisionSchema,
  type StudioProjectV1,
  StudioProjectV1Schema,
} from "../shared/index.ts"
import { StudioError } from "./errors.ts"

export type AudioRecord = {
  readonly bytes: Uint8Array
  readonly digest: string
  readonly format: "wav" | "ogg" | "mp3"
}

export class StudioStore {
  readonly #documentPath: string
  #document: CurrentDocument
  #audio: AudioRecord
  #tail = Promise.resolve()

  private constructor(
    readonly root: string,
    document: CurrentDocument,
    audio: AudioRecord,
  ) {
    this.#documentPath = resolve(root, "document.json")
    this.#document = document
    this.#audio = audio
  }

  static async open(
    root: string,
    initial: CurrentDocument,
    audio: Uint8Array,
  ): Promise<StudioStore> {
    await mkdir(resolve(root, "audio"), { recursive: true })
    const initialAudio = audioRecord(audio, initial.project.audio_asset.format)
    assertAudio(initial.project, initialAudio)
    let document = initial
    let initialize = false
    try {
      document = CurrentDocumentSchema.parse(
        JSON.parse(await readFile(resolve(root, "document.json"), "utf8")),
      )
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      initialize = true
    }
    if (initialize) {
      await writeAudio(root, initialAudio)
      await atomicJson(root, resolve(root, "document.json"), initial)
    }
    const digest = hexDigest(document.project.music.audio_sha256)
    const bytes = await readFile(
      resolve(root, "audio", `${digest}.${document.project.audio_asset.format}`),
    )
    const persistedAudio = audioRecord(bytes, document.project.audio_asset.format)
    assertAudio(document.project, persistedAudio)
    return new StudioStore(root, document, persistedAudio)
  }

  document(): CurrentDocument {
    return structuredClone(this.#document)
  }

  audio(): AudioRecord {
    return { ...this.#audio, bytes: Uint8Array.from(this.#audio.bytes) }
  }

  save(baseRevision: number, projectInput: unknown): Promise<CurrentDocument> {
    return this.#serialized(async () => {
      this.#expectRevision(baseRevision)
      const project = StudioProjectV1Schema.parse(projectInput)
      if (
        hexDigest(project.music.audio_sha256) !== this.#audio.digest ||
        JSON.stringify(project.audio_asset) !== JSON.stringify(this.#document.project.audio_asset)
      ) {
        throw new StudioError(409, "audio_immutable", "Document save cannot replace audio metadata")
      }
      return this.#commit(project)
    })
  }

  replace(
    baseRevision: number,
    projectInput: unknown,
    bytes: Uint8Array,
  ): Promise<CurrentDocument> {
    return this.#serialized(async () => {
      this.#expectRevision(baseRevision)
      const project = StudioProjectV1Schema.parse(projectInput)
      if (bytes.byteLength !== project.audio_asset.byte_length) {
        throw new StudioError(
          400,
          "audio_length",
          "Audio byte length differs from project metadata",
        )
      }
      const nextAudio = audioRecord(bytes, project.audio_asset.format)
      if (nextAudio.digest !== hexDigest(project.music.audio_sha256)) {
        throw new StudioError(400, "audio_sha256", "Audio SHA-256 differs from music metadata")
      }
      await writeAudio(this.root, nextAudio)
      const committed = await this.#commit(project)
      this.#audio = nextAudio
      return committed
    })
  }

  #expectRevision(baseRevision: number): void {
    if (baseRevision !== this.#document.revision) {
      throw new StudioError(
        409,
        "revision_conflict",
        "Document revision is stale",
        this.#document.revision,
      )
    }
  }

  async #commit(project: StudioProjectV1): Promise<CurrentDocument> {
    const next = CurrentDocumentSchema.parse({
      revision: RevisionSchema.parse(this.#document.revision + 1),
      project,
    })
    await atomicJson(this.root, this.#documentPath, next)
    this.#document = next
    return structuredClone(next)
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function audioRecord(bytes: Uint8Array, format: "wav" | "ogg" | "mp3"): AudioRecord {
  return {
    bytes: Uint8Array.from(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
    format,
  }
}

async function writeAudio(root: string, audio: AudioRecord): Promise<void> {
  const path = resolve(root, "audio", `${audio.digest}.${audio.format}`)
  try {
    const existing = audioRecord(await readFile(path), audio.format)
    if (existing.digest !== audio.digest || !Buffer.from(existing.bytes).equals(audio.bytes)) {
      throw new StudioError(500, "audio_corrupt", "Persisted audio asset is corrupt")
    }
    return
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const temporary = resolve(root, "audio", `.${audio.digest}-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(audio.bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, path)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      const existing = audioRecord(await readFile(path), audio.format)
      if (existing.digest !== audio.digest || !Buffer.from(existing.bytes).equals(audio.bytes)) {
        throw new StudioError(500, "audio_corrupt", "Persisted audio asset is corrupt")
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

async function atomicJson(
  root: string,
  destination: string,
  value: CurrentDocument,
): Promise<void> {
  const temporary = resolve(root, `.document-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

function assertAudio(project: StudioProjectV1, audio: AudioRecord): void {
  if (
    audio.digest !== hexDigest(project.music.audio_sha256) ||
    audio.bytes.byteLength !== project.audio_asset.byte_length
  ) {
    throw new StudioError(500, "audio_corrupt", "Persisted audio asset is corrupt")
  }
}

function hexDigest(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
