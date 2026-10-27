import { randomUUID } from "node:crypto"
import { ProjectWorkspaceSchema } from "../../shared/generation-projects.ts"
import { automaticRegionViews } from "../../shared/generation-rules.ts"
import { ChartIdSchema, LibraryRevisionSchema } from "../../shared/library.ts"
import { ChartDocumentSchema } from "../../shared/project.ts"
import {
  type ProjectCommand,
  type ProjectMutation,
  ProjectMutationSchema,
} from "../../shared/project-commands.ts"
import { StudioError } from "../errors.ts"
import { chartSummary } from "../library/chart-summary.ts"
import { nativeMetadata } from "../library/project-factory.ts"
import type { StudioStore } from "../store.ts"
import { expectProjectRevision, requireProject } from "./mutations.ts"
import type { ProjectNativeService } from "./service.ts"
import { componentSummary, projectSummary } from "./views.ts"

export async function generateProject(
  store: StudioStore,
  nativeRules: ProjectNativeService,
  command: Extract<ProjectCommand, { readonly type: "generate_project" }>,
  signal?: AbortSignal,
): Promise<ProjectMutation> {
  signal?.throwIfAborted()
  const project = store.generationProject(command.project_id)
  if (project === undefined)
    throw new StudioError(404, "project_not_found", "Generation project was not found")
  expectProjectRevision(project, command.base_revision)
  const song = store.library().songs.find((candidate) => candidate.id === project.song_id)
  if (song === undefined) throw new StudioError(404, "song_not_found", "Song was not found")
  const audio = await store.songAudio(song.id)
  const generated = await nativeRules.generate(project, audio, command.seed, signal)
  signal?.throwIfAborted()
  if (generated.mode !== project.mode)
    throw new StudioError(422, "generated_mode", "Native generation returned a different mode")
  if (!generated.ucs_validation.valid)
    throw new StudioError(
      422,
      "generated_ucs_invalid",
      "Native generation did not produce valid UCS",
    )
  const chartProject = ChartDocumentSchema.parse({
    schema_version: 1,
    title: nativeMetadata(song.title),
    artist: nativeMetadata(song.artist),
    music: {
      ...project.timing,
      audio_sha256: digestBytes(song.audio.sha256),
    },
    chart: generated.chart,
    evaluation_contract: project.evaluation_contract,
    audio_asset: {
      format: song.audio.format,
      byte_length: song.audio.byte_length,
    },
    ucs_mode: project.mode,
  })
  return store.transact(
    undefined,
    (state) => {
      signal?.throwIfAborted()
      const current = requireProject(state, project.id)
      expectProjectRevision(current, project.revision)
      const currentSong = state.library.songs.find((candidate) => candidate.id === project.song_id)
      if (
        currentSong === undefined ||
        JSON.stringify(currentSong.audio) !== JSON.stringify(song.audio)
      )
        throw new StudioError(409, "song_binding_conflict", "Song audio changed during generation")
      const chartId = ChartIdSchema.parse(randomUUID())
      const generation = {
        ...generated,
        chart_id: chartId,
        project_id: project.id,
        project_revision: project.revision,
        seed: command.seed,
      }
      const next = {
        ...state,
        library: {
          ...state.library,
          revision: LibraryRevisionSchema.parse(state.library.revision + 1),
          charts: [
            ...state.library.charts,
            {
              id: chartId,
              song_id: song.id,
              name: command.name,
              mode: project.mode,
              ...chartSummary(chartProject),
              generated_from: {
                project_id: project.id,
                project_revision: project.revision,
                seed: command.seed,
                automatic_regions: automaticRegionViews(project.generation_rules),
              },
              project: chartProject,
            },
          ],
        },
      }
      return {
        state: next,
        result: ProjectMutationSchema.parse({
          workspace: ProjectWorkspaceSchema.parse({
            revision: next.projects.revision,
            selected_project_id: next.projects.selected_project_id,
            projects: next.projects.records.map(projectSummary),
            components: next.projects.components.map(componentSummary),
          }),
          generation,
        }),
      }
    },
    signal,
  )
}

function digestBytes(hex: string): readonly number[] {
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  )
}
