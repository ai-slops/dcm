import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  GenerationProject,
  ProjectWorkspace,
  ReusableComponent,
} from "../shared/generation-projects.ts"
import { ProjectWorkspaceSchema } from "../shared/generation-projects.ts"
import type { CurrentDocument, StudioProjectV1 } from "../shared/index.ts"
import type { ChartId, LibraryChartDocument, LibrarySnapshot } from "../shared/library.ts"
import type { ComponentId, GenerationProjectId } from "../shared/project-identities.ts"
import { StudioError } from "./errors.ts"
import { type AssetWrite, atomicState, readAsset, writeAsset } from "./library/assets.ts"
import { hexDigest } from "./library/chart-summary.ts"
import { replaceDocumentMutation, saveDocumentMutation } from "./library/document-mutations.ts"
import { currentDocument } from "./library/document-view.ts"
import { migrateV2ToV3 } from "./library/migration.ts"
import {
  initialState,
  LegacyCurrentDocumentSchema,
  PersistedStateV2Schema,
  type PersistedStateV3,
  PersistedStateV3Schema,
  chartDocument as projectForChart,
  snapshot,
} from "./library/state.ts"
import { componentSummary, projectSummary } from "./projects/views.ts"

export type AudioRecord = {
  readonly bytes: Uint8Array
  readonly digest: string
  readonly format: "wav" | "ogg" | "mp3"
}

export type StoreMutation<T> = {
  readonly state: unknown
  readonly result: T
  readonly assets?: readonly AssetWrite[]
}

export class StudioStore {
  readonly #documentPath: string
  #state: PersistedStateV3
  #audio: AudioRecord
  #tail = Promise.resolve()

  private constructor(
    readonly root: string,
    state: PersistedStateV3,
    audio: AudioRecord,
  ) {
    this.#documentPath = resolve(root, "document.json")
    this.#state = state
    this.#audio = audio
  }

  static async open(
    root: string,
    initial: CurrentDocument,
    audio: Uint8Array,
  ): Promise<StudioStore> {
    await Promise.all([
      mkdir(resolve(root, "audio"), { recursive: true }),
      mkdir(resolve(root, "archives"), { recursive: true }),
    ])
    const initialAudio = audioRecord(audio, initial.project.audio_asset.format)
    assertAudio(initial.project, initialAudio)
    let state: PersistedStateV3
    let persist = false
    try {
      const parsed: unknown = JSON.parse(await readFile(resolve(root, "document.json"), "utf8"))
      const current = PersistedStateV3Schema.safeParse(parsed)
      if (current.success) state = current.data
      else {
        const previous = PersistedStateV2Schema.safeParse(parsed)
        state = previous.success
          ? migrateV2ToV3(previous.data)
          : initialState(LegacyCurrentDocumentSchema.parse(parsed))
        persist = true
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      state = initialState(initial)
      persist = true
      await writeAsset(root, audioWrite(initialAudio))
    }
    const active = state.library.charts.find((chart) => chart.id === state.library.active_chart_id)
    if (active === undefined)
      throw new StudioError(500, "library_corrupt", "Active chart is missing")
    const digest = hexDigest(active.project.music.audio_sha256)
    const bytes = await readAsset(root, {
      directory: "audio",
      digest,
      extension: active.project.audio_asset.format,
    })
    const persistedAudio = audioRecord(bytes, active.project.audio_asset.format)
    assertAudio(active.project, persistedAudio)
    if (persist) await atomicState(root, resolve(root, "document.json"), state)
    return new StudioStore(root, state, persistedAudio)
  }

  document(): CurrentDocument {
    return structuredClone(currentDocument(this.#state))
  }

  library(): LibrarySnapshot {
    return structuredClone(snapshot(this.#state))
  }

  projects(): ProjectWorkspace {
    return ProjectWorkspaceSchema.parse({
      revision: this.#state.projects.revision,
      selected_project_id: this.#state.projects.selected_project_id,
      projects: this.#state.projects.records.map(projectSummary),
      components: this.#state.projects.components.map(componentSummary),
    })
  }

  generationProject(id: GenerationProjectId): GenerationProject | undefined {
    const project = this.#state.projects.records.find((candidate) => candidate.id === id)
    return project === undefined ? undefined : structuredClone(project)
  }

  reusableComponent(id: ComponentId): ReusableComponent | undefined {
    const component = this.#state.projects.components.find((candidate) => candidate.id === id)
    return component === undefined ? undefined : structuredClone(component)
  }

  chartDocument(id: ChartId): LibraryChartDocument {
    const result = projectForChart(this.#state, id)
    if (result === undefined) throw new StudioError(404, "chart_not_found", "Chart was not found")
    return structuredClone(result)
  }

  audio(): AudioRecord {
    return cloneAudio(this.#audio)
  }

  async songAudio(id: string): Promise<AudioRecord> {
    const song = this.#state.library.songs.find((candidate) => candidate.id === id)
    if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
    const bytes = await readAsset(this.root, {
      directory: "audio",
      digest: song.audio.sha256,
      extension: song.audio.format,
    })
    const result = audioRecord(bytes, song.audio.format)
    if (result.digest !== song.audio.sha256 || bytes.byteLength !== song.audio.byte_length)
      throw new StudioError(500, "audio_corrupt", "Persisted audio asset is corrupt")
    return result
  }

  async archiveFile(id: string): Promise<Uint8Array> {
    const archive = this.#state.library.archives.find((candidate) => candidate.id === id)
    if (archive === undefined)
      throw new StudioError(404, "archive_not_found", "Archive was not found")
    const bytes = await readAsset(this.root, {
      directory: "archives",
      digest: archive.sha256,
      extension: "zip",
    })
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (digest !== archive.sha256 || bytes.byteLength !== archive.byte_length)
      throw new StudioError(500, "archive_corrupt", "Persisted archive asset is corrupt")
    return bytes
  }

  save(baseRevision: number, projectInput: unknown): Promise<CurrentDocument> {
    return this.transact(undefined, (state) =>
      saveDocumentMutation(state, baseRevision, projectInput),
    )
  }

  replace(
    baseRevision: number,
    projectInput: unknown,
    bytes: Uint8Array,
  ): Promise<CurrentDocument> {
    return this.transact(undefined, (state) =>
      replaceDocumentMutation(state, baseRevision, projectInput, bytes),
    )
  }

  transact<T>(
    libraryRevision: number | undefined,
    operation: (state: PersistedStateV3) => StoreMutation<T> | Promise<StoreMutation<T>>,
    commitSignal?: AbortSignal,
  ): Promise<T> {
    return this.#serialized(async () => {
      if (libraryRevision !== undefined && libraryRevision !== this.#state.library.revision)
        throw new StudioError(
          409,
          "library_revision_conflict",
          "Library revision is stale",
          this.#state.library.revision,
        )
      const mutation = await operation(structuredClone(this.#state))
      const next = PersistedStateV3Schema.parse(mutation.state)
      for (const asset of mutation.assets ?? []) await writeAsset(this.root, asset)
      const active = activeChart(next)
      const bytes = await readAsset(this.root, {
        directory: "audio",
        digest: hexDigest(active.project.music.audio_sha256),
        extension: active.project.audio_asset.format,
      })
      const nextAudio = audioRecord(bytes, active.project.audio_asset.format)
      assertAudio(active.project, nextAudio)
      commitSignal?.throwIfAborted()
      await atomicState(this.root, this.#documentPath, next)
      this.#state = next
      this.#audio = nextAudio
      return structuredClone(mutation.result)
    })
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

function activeChart(state: PersistedStateV3) {
  const chart = state.library.charts.find(
    (candidate) => candidate.id === state.library.active_chart_id,
  )
  if (chart === undefined) throw new StudioError(500, "library_corrupt", "Active chart is missing")
  return chart
}

function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return {
    bytes: Uint8Array.from(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
    format,
  }
}

function audioWrite(audio: AudioRecord): AssetWrite {
  return { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes }
}

function assertAudio(project: StudioProjectV1, audio: AudioRecord): void {
  if (
    audio.digest !== hexDigest(project.music.audio_sha256) ||
    audio.bytes.byteLength !== project.audio_asset.byte_length
  )
    throw new StudioError(500, "audio_corrupt", "Audio bytes differ from project metadata")
}

function cloneAudio(audio: AudioRecord): AudioRecord {
  return { ...audio, bytes: Uint8Array.from(audio.bytes) }
}
