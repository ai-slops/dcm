import type { Dispatch, SetStateAction } from "react"

import type { CurrentDocument, Revision } from "../../shared/index.ts"
import type { LibraryMutation, LibrarySnapshot } from "../../shared/library.ts"
import { errorMessage } from "./action-utils.ts"
import {
  type LibraryMutationDocumentPolicy,
  type LibrarySelectionPreference,
  libraryDocumentEffect,
} from "./library-workflow.ts"

export type LibraryMutationRun = {
  readonly label: string
  readonly startingRevision: Revision
  readonly policy: LibraryMutationDocumentPolicy
  readonly operation: () => Promise<LibraryMutation>
}

type LibraryMutationRunnerInput = {
  readonly onDocument: (document: CurrentDocument) => void
  readonly onStatus: (status: string) => void
  readonly setBusy: Dispatch<SetStateAction<boolean>>
  readonly setError: Dispatch<SetStateAction<string>>
  readonly acceptLibrary: (
    snapshot: LibrarySnapshot,
    preference?: LibrarySelectionPreference,
  ) => boolean
  readonly setOperationStatus: Dispatch<SetStateAction<string>>
}

export function useLibraryMutationRunner(input: LibraryMutationRunnerInput) {
  return async (run: LibraryMutationRun): Promise<void> => {
    input.setBusy(true)
    input.setError("")
    input.setOperationStatus(run.label)
    input.onStatus(run.label)
    try {
      const mutation = await run.operation()
      const accepted = input.acceptLibrary(
        mutation.library,
        run.policy === "replace_document" ? "prefer_active" : "retain",
      )
      if (!accepted) {
        const stale = "A newer library state is already visible; the stale response was ignored."
        input.onStatus(stale)
        input.setOperationStatus(stale)
        return
      }
      const effect = libraryDocumentEffect(
        run.policy,
        run.startingRevision,
        mutation.document.revision,
      )
      if (effect === "accept") input.onDocument(mutation.document)
      const completed =
        effect === "stale"
          ? "Library updated. The open chart changed elsewhere; your browser draft was preserved."
          : `${run.label} complete`
      input.onStatus(completed)
      input.setOperationStatus(completed)
    } catch (caught) {
      const message = errorMessage(caught)
      input.setError(message)
      input.setOperationStatus("")
      input.onStatus(message)
    } finally {
      input.setBusy(false)
    }
  }
}
