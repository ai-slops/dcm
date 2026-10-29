import type {
  BeatProjectWorkspace,
  BeatReusableComponent,
  GenerationProjectV2,
} from "../../shared/beat-projects.ts"
import {
  type BaseUcsSourceOption,
  BaseUcsSourceOptionsSchema,
  type BeatChartDocument,
  BeatChartDocumentSchema,
  BeatProjectWorkspaceSchema,
  BeatReusableComponentSchema,
  GenerationProjectV2Schema,
} from "../../shared/beat-projects.ts"
import type { SongId } from "../../shared/library.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ProjectCommandSchema, ProjectMutationSchema } from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { mutationHeaders, typedRequest } from "./client.ts"
import { http } from "./http.ts"

const projectsRoot = "/api/v1/projects"

export const projectsApi = {
  list(): Promise<BeatProjectWorkspace> {
    return typedRequest(http.get(projectsRoot), BeatProjectWorkspaceSchema)
  },
  project(id: GenerationProjectId): Promise<GenerationProjectV2> {
    return typedRequest(
      http.get(`${projectsRoot}/${encodeURIComponent(id)}`),
      GenerationProjectV2Schema,
    )
  },
  songTemplate(songId: SongId): Promise<BeatChartDocument> {
    return typedRequest(
      http.get(`${projectsRoot}/song-template/${encodeURIComponent(songId)}`),
      BeatChartDocumentSchema,
    )
  },
  baseSources(songId: SongId): Promise<readonly BaseUcsSourceOption[]> {
    return typedRequest(
      http.get(`${projectsRoot}/base-sources/${encodeURIComponent(songId)}`),
      BaseUcsSourceOptionsSchema,
    )
  },
  component(id: ComponentId): Promise<BeatReusableComponent> {
    return typedRequest(
      http.get(`/api/v1/components/${encodeURIComponent(id)}`),
      BeatReusableComponentSchema,
    )
  },
  command(csrfToken: string, command: ProjectCommand): Promise<ProjectMutation> {
    const input = ProjectCommandSchema.parse(command)
    return typedRequest(
      http.post(`${projectsRoot}/actions`, {
        headers: mutationHeaders(csrfToken),
        json: input,
      }),
      ProjectMutationSchema,
    )
  },
}
