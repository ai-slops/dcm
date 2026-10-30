import { randomUUID } from "node:crypto"
import { nativeChartToBeatCore } from "../../shared/beat-native-projection.ts"
import { BeatChartDocumentSchema, BeatProjectWorkspaceSchema } from "../../shared/beat-projects.ts"
import { ChartIdSchema, LibraryRevisionSchema } from "../../shared/library.ts"
import {
  type ProjectCommand,
  type ProjectMutation,
  ProjectMutationSchema,
} from "../../shared/project-commands.ts"
import { StudioError } from "../errors.ts"
import { beatChartSummary } from "../library/state-v4.ts"
import { projectBeatGenerationNative } from "../native/beat-project-adapter.ts"
import type { StudioStore } from "../store.ts"
import { expectProjectRevision, requireProject } from "./mutations.ts"
import type { ProjectNativeService } from "./service.ts"
import { projectSummary } from "./views.ts"

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
  const projection = projectBeatGenerationNative(project)
  if (projection.kind === "unsupported")
    throw new StudioError(422, projection.capability.code, JSON.stringify(projection.capability))
  const generated = await nativeRules.generate(projection.project, audio, command.seed, signal)
  signal?.throwIfAborted()
  if (generated.mode !== project.mode)
    throw new StudioError(422, "generated_mode", "Native generation returned a different mode")
  if (!generated.ucs_validation.valid)
    throw new StudioError(
      422,
      "generated_ucs_invalid",
      "Native generation did not produce valid UCS",
    )
  const beatChart = nativeChartToBeatCore(generated.chart, project.mode, project.timing)
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
      const chartProject = BeatChartDocumentSchema.parse({
        schema_version: 1,
        title: currentSong.title,
        artist: currentSong.artist,
        chart_artist: project.chart_artist,
        mode: project.mode,
        timing: beatChart.timing,
        notes: beatChart.notes,
        audio_sha256: currentSong.audio.sha256,
        evaluation_contract: project.evaluation_contract,
        audio_asset: {
          format: currentSong.audio.format,
          byte_length: currentSong.audio.byte_length,
        },
      })
      const chartId = ChartIdSchema.parse(randomUUID())
      const generation = {
        ...generated,
        chart: beatChart,
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
              song_id: currentSong.id,
              name: command.name,
              ...beatChartSummary(chartProject),
              generated_from: {
                project_id: project.id,
                project_revision: project.revision,
                seed: command.seed,
                automatic_regions:
                  project.generation_rules.schema_version === 1
                    ? []
                    : project.generation_rules.regions.map((region) => ({
                        id: region.id,
                        name: region.name,
                        start: region.rules.start,
                        end: region.rules.end,
                      })),
              },
              project: chartProject,
            },
          ],
        },
      }
      return {
        state: next,
        result: ProjectMutationSchema.parse({
          workspace: BeatProjectWorkspaceSchema.parse({
            revision: next.projects.revision,
            selected_project_id: next.projects.selected_project_id,
            projects: next.projects.records.map(projectSummary),
            components: next.projects.components,
          }),
          generation,
        }),
      }
    },
    signal,
  )
}
