import type { RefObject } from "react"

import type { BeatChartDocument, DocumentOrigin, Revision } from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import type { SaveResult } from "./studio-types.ts"

type DocumentSaveInput = {
  readonly csrfToken: string
  readonly project: BeatChartDocument
  readonly projectRef: RefObject<BeatChartDocument>
  readonly revision: Revision
  readonly onProject: (project: BeatChartDocument) => void
  readonly onPersistedProject: (project: BeatChartDocument) => void
  readonly onRevision: (revision: Revision) => void
  readonly onOrigin: (origin: DocumentOrigin | undefined) => void
  readonly onStatus: (status: string) => void
  readonly onValidationError: (message: string) => void
}

export function useDocumentSave(input: DocumentSaveInput) {
  return async (): Promise<SaveResult | null> => {
    input.onStatus("Saving")
    const savingProject = input.project
    try {
      const document = await studioApi.save(input.csrfToken, {
        base_revision: input.revision,
        project: savingProject,
      })
      const savedCurrent = input.projectRef.current === savingProject
      input.onRevision(document.revision)
      input.onOrigin(document.origin)
      input.onPersistedProject(document.project)
      if (savedCurrent) input.onProject(document.project)
      input.onValidationError("")
      input.onStatus(savedCurrent ? "Saved" : "Saved older draft")
      return { kind: savedCurrent ? "saved_current" : "saved_older", document }
    } catch (error) {
      input.onStatus("Save failed")
      input.onValidationError(error instanceof Error ? error.message : "Save failed. Try again.")
      return null
    }
  }
}
