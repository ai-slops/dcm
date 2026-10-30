import { ArrowLeft, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"

import type { Bootstrap } from "../../shared/api.ts"
import type { GenerationProjectId } from "../../shared/project-identities.ts"
import { ProjectGridEditor } from "./ProjectGridEditor.tsx"
import { Button } from "./primitives.tsx"
import { useGeneratedChartOpen } from "./useGeneratedChartOpen.ts"
import { useProjectGridEditor } from "./useProjectGridEditor.ts"

export function ProjectEditPage(props: {
  readonly bootstrap: Bootstrap
  readonly projectId: GenerationProjectId
}) {
  const editor = useProjectGridEditor({
    csrfToken: props.bootstrap.csrf_token,
    projectId: props.projectId,
  })
  const [confirmBack, setConfirmBack] = useState(false)
  const generatedOpen = useGeneratedChartOpen({
    csrfToken: props.bootstrap.csrf_token,
    dirty: false,
    generation: editor.generation,
    revision: props.bootstrap.document.revision,
    onClose: () => {
      editor.allowLeave()
      window.location.assign("/")
    },
    onDocument: () => undefined,
    onSave: () => Promise.resolve(null),
    onStatus: () => undefined,
  })

  useEffect(() => {
    if (editor.busy || !editor.dirty) setConfirmBack(false)
  }, [editor.busy, editor.dirty])

  function leave(): void {
    if (projectNavigationLocked(editor.busy)) return
    editor.allowLeave()
    window.setTimeout(() => window.location.assign("/"), 0)
  }

  function requestBack(): void {
    if (projectNavigationLocked(editor.busy)) return
    if (editor.dirty) setConfirmBack(true)
    else leave()
  }

  if (editor.loaded.kind === "error")
    return (
      <main className="empty-state">
        <h1>Project editor unavailable</h1>
        <p>{editor.loaded.message}</p>
        <Button
          icon={<RefreshCw aria-hidden="true" size={15} />}
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
        <Button onClick={() => window.location.assign("/")}>Back to Studio</Button>
      </main>
    )
  if (editor.loaded.kind === "loading" || editor.draft === null)
    return (
      <main className="empty-state" role="status">
        Loading the saved project, song, and authoritative ZIP timing template...
      </main>
    )

  return (
    <main className="project-edit-page">
      <header className="project-edit-page__header">
        <Button
          variant="ghost"
          icon={<ArrowLeft aria-hidden="true" size={16} />}
          disabled={editor.busy || generatedOpen.busy}
          onClick={requestBack}
        >
          Back to projects
        </Button>
        <div>
          <h1>Project grid authoring</h1>
          <p>Fixed notes and named automatic regions are saved to this project only.</p>
        </div>
      </header>
      {confirmBack ? (
        <section
          className="project-edit-page__guard"
          role="alertdialog"
          aria-label="Unsaved project draft"
        >
          <strong>Leave without saving?</strong>
          <p>Your exact local project draft will be discarded.</p>
          <div className="cluster">
            <Button variant="danger" disabled={editor.busy} onClick={leave}>
              Discard and leave
            </Button>
            <Button onClick={() => setConfirmBack(false)}>Cancel</Button>
          </div>
        </section>
      ) : null}
      <ProjectGridEditor
        busy={editor.busy || generatedOpen.busy}
        components={editor.loaded.components}
        dirty={editor.dirty}
        generation={editor.generation}
        project={editor.draft}
        song={editor.loaded.song}
        onApplyFragment={(componentId, anchor) => void editor.applyFragment(componentId, anchor)}
        onGenerate={(name, seed) => void editor.generate(name, seed)}
        onOpenGenerated={generatedOpen.request}
        onProject={editor.setDraft}
        onPublishFragment={(name, start, end) => void editor.publishFragment(name, start, end)}
        onSave={() => void editor.save()}
      />
      {editor.error === "" && generatedOpen.error === "" ? null : (
        <p className="operation-result operation-result--error" role="alert">
          {editor.error || generatedOpen.error}. Your unsaved draft is still present.
        </p>
      )}
    </main>
  )
}

export function projectNavigationLocked(busy: boolean): boolean {
  return busy
}
