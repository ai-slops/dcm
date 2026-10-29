import type { BeatChartDocument, CurrentDocument } from "../../shared/index.ts"

export type AppliedDocumentState = {
  readonly project: BeatChartDocument
  readonly persistedProject: BeatChartDocument
  readonly historyProject: BeatChartDocument | null
  readonly revision: CurrentDocument["revision"]
}

export function reconcileAppliedDocument(input: {
  readonly startedFromProject: BeatChartDocument
  readonly currentProject: BeatChartDocument
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
