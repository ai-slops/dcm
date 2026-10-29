import { useCallback, useRef, useState } from "react"

import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { GenerationProjectId } from "../../shared/project-identities.ts"
import { projectsApi } from "../api/projects-client.ts"
import { errorMessage } from "./action-utils.ts"
import { projectLoadIsCurrent } from "./project-manager-commands.ts"

type ProjectLoaderInput = {
  readonly onProject: (project: GenerationProjectV2) => void
  readonly onError: (message: string) => void
}

export function useProjectLoader(input: ProjectLoaderInput) {
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => {
    generation.current += 1
    setLoading(false)
  }, [])
  const load = useCallback(
    async (id: GenerationProjectId): Promise<void> => {
      const request = ++generation.current
      setLoading(true)
      input.onError("")
      try {
        const project = await projectsApi.project(id)
        if (projectLoadIsCurrent(request, generation.current)) input.onProject(project)
      } catch (caught) {
        if (projectLoadIsCurrent(request, generation.current)) input.onError(errorMessage(caught))
      } finally {
        if (projectLoadIsCurrent(request, generation.current)) setLoading(false)
      }
    },
    [input.onError, input.onProject],
  )
  return { invalidate, load, loading } as const
}
