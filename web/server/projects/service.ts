import {
  type BaseUcsSourceOption,
  BaseUcsSourceOptionsSchema,
  type BeatProjectWorkspace,
  type BeatReusableComponent,
  type GenerationProjectV2,
} from "../../shared/beat-projects.ts"
import type { GenerationProject } from "../../shared/generation-projects.ts"
import type { ChartId, LibraryChartDocument, LibrarySong, SongId } from "../../shared/library.ts"
import type {
  NativeRuleGeneration,
  ProjectCommand,
  ProjectMutation,
} from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord, StudioStore } from "../store.ts"
import { executeProjectCommand } from "./dispatcher.ts"

export interface ProjectNativeService {
  generate(
    project: GenerationProject,
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ): Promise<NativeRuleGeneration>
}

export class ProjectService {
  constructor(
    readonly store: StudioStore,
    readonly nativeRules: ProjectNativeService,
  ) {}

  list(): BeatProjectWorkspace {
    return this.store.projects()
  }

  songs(): readonly LibrarySong[] {
    return this.store.library().songs
  }

  chart(id: ChartId): LibraryChartDocument {
    return this.store.chartDocument(id)
  }

  baseSources(songId: SongId): readonly BaseUcsSourceOption[] {
    const library = this.store.library()
    const song = library.songs.find((candidate) => candidate.id === songId)
    if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
    const saved = library.charts
      .filter((chart) => chart.song_id === songId)
      .map((chart) => ({
        ref: { source: "saved_chart" as const, chart_id: chart.id },
        label: chart.name,
        mode: chart.mode,
        timing: this.store.chartDocument(chart.id).project.timing,
      }))
    const archiveSource = song.archive_source
    const retained: readonly BaseUcsSourceOption[] =
      archiveSource === undefined
        ? []
        : [
            {
              ref: { source: "retained_timing", song_id: song.id },
              label: "Original archive timing",
              mode: archiveSource.mode,
              timing: archiveSource.timing,
            },
          ]
    const archive: readonly BaseUcsSourceOption[] =
      song.archive_id === undefined || archiveSource === undefined
        ? []
        : library.archives
            .filter((candidate) => candidate.id === song.archive_id)
            .map((candidate) => ({
              ref: {
                source: "archive_entry" as const,
                archive_id: candidate.id,
                archive_sha256: candidate.sha256,
                entry_name: archiveSource.chart_name,
              },
              label: archiveSource.chart_name,
              mode: archiveSource.mode,
              timing: archiveSource.timing,
            }))
    return BaseUcsSourceOptionsSchema.parse([...archive, ...retained, ...saved])
  }

  read(id: GenerationProjectId): GenerationProjectV2 {
    const project = this.#record(id)
    if (project === undefined)
      throw new StudioError(404, "project_not_found", "Generation project was not found")
    return structuredClone(project)
  }

  component(id: ComponentId): BeatReusableComponent {
    const component = this.#component(id)
    if (component === undefined)
      throw new StudioError(404, "component_not_found", "Reusable component was not found")
    return structuredClone(component)
  }

  command(command: ProjectCommand, signal?: AbortSignal): Promise<ProjectMutation> {
    signal?.throwIfAborted()
    return executeProjectCommand(this.store, this.nativeRules, command, signal)
  }

  #record(id: GenerationProjectId): GenerationProjectV2 | undefined {
    return this.store.generationProject(id)
  }

  #component(id: ComponentId): BeatReusableComponent | undefined {
    return this.store.reusableComponent(id)
  }
}
