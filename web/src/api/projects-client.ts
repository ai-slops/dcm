import type {
  GenerationProject,
  MusicTiming,
  ProjectWorkspace,
  ReusableComponent,
} from "../../shared/generation-projects.ts"
import {
  GenerationProjectSchema,
  ProjectWorkspaceSchema,
  ReusableComponentSchema,
} from "../../shared/generation-projects.ts"
import type { SongId } from "../../shared/library.ts"
import { ChartDocumentSchema } from "../../shared/project.ts"
import type { ProjectCommand, ProjectMutation } from "../../shared/project-commands.ts"
import { ProjectCommandSchema, ProjectMutationSchema } from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { mutationHeaders, typedRequest } from "./client.ts"
import { http } from "./http.ts"

const projectsRoot = "/api/v1/projects"

export const projectsApi = {
  list(): Promise<ProjectWorkspace> {
    return typedRequest(http.get(projectsRoot), ProjectWorkspaceSchema)
  },
  project(id: GenerationProjectId): Promise<GenerationProject> {
    return typedRequest(
      http.get(`${projectsRoot}/${encodeURIComponent(id)}`),
      GenerationProjectSchema,
    )
  },
  async songTemplate(songId: SongId): Promise<MusicTiming> {
    const template = await typedRequest(
      http.get(`${projectsRoot}/song-template/${encodeURIComponent(songId)}`),
      ChartDocumentSchema,
    )
    const { audio_sha256: _audioDigest, ...timing } = template.music
    return timing
  },
  component(id: ComponentId): Promise<ReusableComponent> {
    return typedRequest(
      http.get(`/api/v1/components/${encodeURIComponent(id)}`),
      ReusableComponentSchema,
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
