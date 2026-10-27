import type {
  GenerationProject,
  ProjectWorkspace,
  ReusableComponent,
} from "../../shared/generation-projects.ts"
import {
  GenerationProjectSchema,
  ProjectWorkspaceSchema,
  ReusableComponentSchema,
} from "../../shared/generation-projects.ts"
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
