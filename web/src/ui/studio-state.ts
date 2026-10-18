import type { CurrentDocument, StudioProjectV1 } from "../../shared/index.ts"

export type AppliedDocumentState = {
  readonly project: StudioProjectV1
  readonly persistedProject: StudioProjectV1
  readonly historyProject: StudioProjectV1 | null
  readonly revision: CurrentDocument["revision"]
}

export function reconcileAppliedDocument(input: {
  readonly startedFromProject: StudioProjectV1
  readonly currentProject: StudioProjectV1
  readonly document: CurrentDocument
}): AppliedDocumentState {
  const hasNewerDraft = input.currentProject !== input.startedFromProject
  return {
    project: hasNewerDraft ? input.currentProject : input.document.project,
    persistedProject: input.document.project,
    historyProject: hasNewerDraft ? null : input.startedFromProject,
    revision: input.document.revision,
  }
}
