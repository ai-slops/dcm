import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  BeatCurrentDocument,
  BeatReusableComponent,
  GenerationProjectV2,
} from "../shared/beat-projects.ts"
import { BeatCurrentDocumentSchema, BeatProjectWorkspaceSchema } from "../shared/beat-projects.ts"
import type { ChartId, LibraryChartDocument, LibrarySnapshot } from "../shared/library.ts"
import { LibrarySnapshotSchema } from "../shared/library.ts"
import type { ComponentId, GenerationProjectId } from "../shared/project-identities.ts"
import { StudioError } from "./errors.ts"
import { type AssetWrite, atomicState, readAsset, writeAsset } from "./library/assets.ts"
import {
  replaceBeatDocumentMutation,
  saveBeatDocumentMutation,
} from "./library/document-mutations-v4.ts"
import { migrateV3ToV4 } from "./library/migrate-v3-v4.ts"
import { migrateV2ToV3 } from "./library/migration.ts"
import {
  initialState,
  LegacyCurrentDocumentSchema,
  PersistedStateV2Schema,
  PersistedStateV3Schema,
} from "./library/state.ts"
import { type PersistedStateV4, PersistedStateV4Schema } from "./library/state-v4.ts"
import {
  type AudioRecord,
  activeChart,
  assertAudio,
  assertLegacyAudio,
  audioRecord,
  audioWrite,
  cloneAudio,
  initialBeatState,
} from "./store-support.ts"

export type { AudioRecord } from "./store-support.ts"

export type StoreMutation<T> = {
  readonly state: unknown
  readonly result: T
  readonly assets?: readonly AssetWrite[]
}

export class StudioStore {
  readonly #documentPath: string
  #state: PersistedStateV4
  #audio: AudioRecord
  #tail = Promise.resolve()

  private constructor(
    readonly root: string,
    state: PersistedStateV4,
    audio: AudioRecord,
  ) {
    this.#documentPath = resolve(root, "document.json")
    this.#state = state
    this.#audio = audio
  }

  static async open(root: string, initial: unknown, audio: Uint8Array): Promise<StudioStore> {
    await Promise.all([
      mkdir(resolve(root, "audio"), { recursive: true }),
      mkdir(resolve(root, "archives"), { recursive: true }),
    ])
    const beatInitial = BeatCurrentDocumentSchema.safeParse(initial)
    const legacyInitial = beatInitial.success
      ? undefined
      : LegacyCurrentDocumentSchema.parse(initial)
    const initialFormat = beatInitial.success
      ? beatInitial.data.project.audio_asset.format
      : legacyInitial?.project.audio_asset.format
    if (initialFormat === undefined)
      throw new StudioError(500, "initial_document_invalid", "Initial document has no audio format")
    const initialAudio = audioRecord(audio, initialFormat)
    if (beatInitial.success) assertAudio(beatInitial.data.project, initialAudio)
    else if (legacyInitial !== undefined) assertLegacyAudio(legacyInitial.project, initialAudio)
    let state: PersistedStateV4
    let persist = false
    try {
      const parsed: unknown = JSON.parse(await readFile(resolve(root, "document.json"), "utf8"))
      const current = PersistedStateV4Schema.safeParse(parsed)
      if (current.success) state = current.data
      else {
        const v3 = PersistedStateV3Schema.safeParse(parsed)
        const v2 = PersistedStateV2Schema.safeParse(parsed)
        state = v3.success
          ? migrateV3ToV4(v3.data)
          : v2.success
            ? migrateV3ToV4(migrateV2ToV3(v2.data))
            : migrateV3ToV4(initialState(LegacyCurrentDocumentSchema.parse(parsed)))
        persist = true
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      state = beatInitial.success
        ? initialBeatState(beatInitial.data)
        : migrateV3ToV4(initialState(LegacyCurrentDocumentSchema.parse(legacyInitial)))
      persist = true
      await writeAsset(root, audioWrite(initialAudio))
    }
    const active = state.library.charts.find((chart) => chart.id === state.library.active_chart_id)
    if (active === undefined)
      throw new StudioError(500, "library_corrupt", "Active chart is missing")
    const digest = active.project.audio_sha256
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

  document(): BeatCurrentDocument {
    return structuredClone(this.#state.document)
  }

  library(): LibrarySnapshot {
    return structuredClone(
      LibrarySnapshotSchema.parse({
        ...this.#state.library,
        charts: this.#state.library.charts.map(({ project: _project, ...chart }) => chart),
      }),
    )
  }

  projects() {
    return BeatProjectWorkspaceSchema.parse({
      revision: this.#state.projects.revision,
      selected_project_id: this.#state.projects.selected_project_id,
      projects: this.#state.projects.records.map(
        ({
          timing: _timing,
          evaluation_contract: _evaluation,
          generation_rules: _rules,
          ...summary
        }) => summary,
      ),
      components: this.#state.projects.components,
    })
  }

  generationProject(id: GenerationProjectId): GenerationProjectV2 | undefined {
    const project = this.#state.projects.records.find((candidate) => candidate.id === id)
    return project === undefined ? undefined : structuredClone(project)
  }

  reusableComponent(id: ComponentId): BeatReusableComponent | undefined {
    const component = this.#state.projects.components.find((candidate) => candidate.id === id)
    return component === undefined ? undefined : structuredClone(component)
  }

  chartDocument(id: ChartId): LibraryChartDocument {
    const stored = this.#state.library.charts.find((chart) => chart.id === id)
    if (stored === undefined) throw new StudioError(404, "chart_not_found", "Chart was not found")
    const song = this.#state.library.songs.find((candidate) => candidate.id === stored.song_id)
    if (song === undefined) throw new StudioError(500, "library_corrupt", "Chart song is missing")
    const { project, ...chart } = stored
    return structuredClone({ chart, song, project })
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

  save(baseRevision: number, projectInput: unknown): Promise<BeatCurrentDocument> {
    return this.transact(undefined, (state) =>
      saveBeatDocumentMutation(state, baseRevision, projectInput),
    )
  }

  replace(
    baseRevision: number,
    projectInput: unknown,
    bytes: Uint8Array,
  ): Promise<BeatCurrentDocument> {
    return this.transact(undefined, (state) =>
      replaceBeatDocumentMutation(state, baseRevision, projectInput, bytes),
    )
  }

  transact<T>(
    libraryRevision: number | undefined,
    operation: (state: PersistedStateV4) => StoreMutation<T> | Promise<StoreMutation<T>>,
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
      const next = PersistedStateV4Schema.parse(mutation.state)
      for (const asset of mutation.assets ?? []) await writeAsset(this.root, asset)
      const active = activeChart(next)
      const bytes = await readAsset(this.root, {
        directory: "audio",
        digest: active.project.audio_sha256,
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
