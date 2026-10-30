import { useCallback, useEffect, useMemo, useState } from "react"
import type { Beat } from "../../shared/beat.ts"
import type { BeatReusableComponent, GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { LibrarySong } from "../../shared/library.ts"
import type { ProjectGenerationResult } from "../../shared/project-commands.ts"
import type { ComponentId, GenerationProjectId } from "../../shared/project-identities.ts"
import { libraryApi } from "../api/library-client.ts"
import { projectsApi } from "../api/projects-client.ts"
import { errorMessage } from "./action-utils.ts"
import { useBeforeUnload } from "./useBeforeUnload.ts"

type LoadedProjectEditor = {
  readonly kind: "ready"
  readonly project: GenerationProjectV2
  readonly song: LibrarySong
  readonly components: readonly BeatReusableComponent[]
}

export type ProjectEditorLoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | LoadedProjectEditor

class MissingProjectMutationError extends Error {
  override readonly name = "MissingProjectMutationError"
}

export function useProjectGridEditor(input: {
  readonly csrfToken: string
  readonly projectId: GenerationProjectId
}) {
  const [loaded, setLoaded] = useState<ProjectEditorLoadState>({ kind: "loading" })
  const [draft, setDraft] = useState<GenerationProjectV2 | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [generation, setGeneration] = useState<ProjectGenerationResult | null>(null)
  const [intentionalLeave, setIntentionalLeave] = useState(false)
  const updateDraft = useCallback((project: GenerationProjectV2) => {
    setDraft(project)
    setGeneration(null)
  }, [])

  useEffect(() => {
    let active = true
    setLoaded({ kind: "loading" })
    setDraft(null)
    void (async () => {
      try {
        const project = await projectsApi.project(input.projectId)
        const [library, workspace] = await Promise.all([libraryApi.list(), projectsApi.list()])
        const song = library.songs.find((candidate) => candidate.id === project.song_id)
        if (!active) return
        if (song === undefined) {
          setLoaded({ kind: "error", message: "The project song is not in the saved library." })
          return
        }
        setDraft(project)
        setLoaded({
          kind: "ready",
          project,
          song,
          components: workspace.components,
        })
      } catch (caught) {
        if (active) setLoaded({ kind: "error", message: errorMessage(caught) })
      }
    })()
    return () => {
      active = false
    }
  }, [input.projectId])

  const dirty = useMemo(
    () =>
      loaded.kind === "ready" &&
      draft !== null &&
      JSON.stringify(draft) !== JSON.stringify(loaded.project),
    [draft, loaded],
  )
  useBeforeUnload(dirty && !intentionalLeave)
  const allowLeave = useCallback(() => setIntentionalLeave(true), [])

  const save = useCallback(async (): Promise<boolean> => {
    if (loaded.kind !== "ready" || draft === null) return false
    setBusy(true)
    setError("")
    try {
      const mutation = await projectsApi.command(input.csrfToken, {
        type: "write_project",
        project_id: loaded.project.id,
        base_revision: loaded.project.revision,
        name: draft.name,
        chart_artist: draft.chart_artist,
        timing: draft.timing,
        evaluation_contract: draft.evaluation_contract,
        generation_rules: draft.generation_rules,
      })
      if (mutation.project === undefined)
        throw new MissingProjectMutationError("Project save returned no project")
      setDraft(mutation.project)
      setLoaded({ ...loaded, project: mutation.project, components: mutation.workspace.components })
      return true
    } catch (caught) {
      setError(errorMessage(caught))
      return false
    } finally {
      setBusy(false)
    }
  }, [draft, input.csrfToken, loaded])

  const generate = useCallback(
    async (name: string, seed: string): Promise<void> => {
      if (loaded.kind !== "ready" || draft === null || dirty) return
      setBusy(true)
      setError("")
      try {
        const mutation = await projectsApi.command(input.csrfToken, {
          type: "generate_project",
          project_id: loaded.project.id,
          base_revision: loaded.project.revision,
          name,
          seed,
        })
        const nextProject = mutation.project ?? loaded.project
        if (mutation.project !== undefined) setDraft(mutation.project)
        setLoaded({ ...loaded, project: nextProject, components: mutation.workspace.components })
        setGeneration(mutation.generation ?? null)
      } catch (caught) {
        setError(errorMessage(caught))
      } finally {
        setBusy(false)
      }
    },
    [dirty, draft, input.csrfToken, loaded],
  )

  const publishFragment = useCallback(
    async (name: string, start: Beat, end: Beat): Promise<void> => {
      if (loaded.kind !== "ready" || draft === null || dirty) return
      setBusy(true)
      setError("")
      try {
        const mutation = await projectsApi.command(input.csrfToken, {
          type: "publish_component",
          project_id: loaded.project.id,
          base_revision: loaded.project.revision,
          kind: "note_fragment",
          name,
          start,
          end,
        })
        const nextProject = mutation.project ?? loaded.project
        if (mutation.project !== undefined) setDraft(mutation.project)
        setLoaded({ ...loaded, project: nextProject, components: mutation.workspace.components })
      } catch (caught) {
        setError(errorMessage(caught))
      } finally {
        setBusy(false)
      }
    },
    [dirty, draft, input.csrfToken, loaded],
  )

  const applyFragment = useCallback(
    async (componentId: ComponentId, at: Beat): Promise<void> => {
      if (loaded.kind !== "ready" || draft === null || dirty) return
      setBusy(true)
      setError("")
      try {
        const mutation = await projectsApi.command(input.csrfToken, {
          type: "apply_component",
          project_id: loaded.project.id,
          base_revision: loaded.project.revision,
          component_id: componentId,
          at,
        })
        const nextProject = mutation.project ?? loaded.project
        if (mutation.project !== undefined) setDraft(mutation.project)
        setLoaded({ ...loaded, project: nextProject, components: mutation.workspace.components })
      } catch (caught) {
        setError(errorMessage(caught))
      } finally {
        setBusy(false)
      }
    },
    [dirty, draft, input.csrfToken, loaded],
  )

  return {
    allowLeave,
    applyFragment,
    busy,
    dirty,
    draft,
    error,
    generate,
    generation,
    loaded,
    publishFragment,
    save,
    setDraft: updateDraft,
  } as const
}
