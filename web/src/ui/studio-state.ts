import type { CurrentDocument, StudioProjectV1 } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"

export type AppliedDocumentState = {
  readonly project: StudioProjectV1
  readonly persistedProject: StudioProjectV1
  readonly historyProject: StudioProjectV1 | null
  readonly revision: CurrentDocument["revision"]
}

export type ReplacementEditorState = {
  readonly tick: number
  readonly lane: PanelIndex
  readonly holdTicks: number
  readonly quantize: number
  readonly windowStart: number
}

export function editorStateForReplacement(project: StudioProjectV1): ReplacementEditorState {
  return {
    tick: 0,
    lane: 0,
    holdTicks: project.chart.ticks_per_beat,
    quantize: 1,
    windowStart: 0,
  }
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
