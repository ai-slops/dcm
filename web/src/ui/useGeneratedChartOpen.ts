import { useState } from "react"

import type { CurrentDocument, Revision } from "../../shared/index.ts"
import type { ProjectGenerationResult } from "../../shared/project-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import { errorMessage } from "./action-utils.ts"
import { guardedSwitchDocument } from "./library-workflow.ts"
import type { SaveResult } from "./studio-types.ts"

type GeneratedChartOpenInput = {
  readonly csrfToken: string
  readonly dirty: boolean
  readonly generation: ProjectGenerationResult | null
  readonly revision: Revision
  readonly onClose: () => void
  readonly onDocument: (document: CurrentDocument) => void
  readonly onSave: () => Promise<SaveResult | null>
  readonly onStatus: (status: string) => void
}

export function useGeneratedChartOpen(input: GeneratedChartOpenInput) {
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function open(baseRevision: Revision): Promise<void> {
    if (input.generation === null) return
    setBusy(true)
    setError("")
    try {
      const library = await libraryApi.list()
      const mutation = await libraryApi.command(input.csrfToken, {
        type: "open_chart",
        library_revision: library.revision,
        base_revision: baseRevision,
        chart_id: input.generation.chart_id,
      })
      input.onDocument(mutation.document)
      input.onStatus("Generated chart opened")
      setPending(false)
      input.onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function saveAndOpen(): Promise<void> {
    setBusy(true)
    setError("")
    try {
      const result = await input.onSave()
      const saved = guardedSwitchDocument(result)
      if (saved === null) {
        setError(
          result?.kind === "saved_older"
            ? "A newer browser draft exists. It was preserved, and the generated chart was not opened."
            : "Save failed. The current browser draft was preserved.",
        )
        return
      }
      await open(saved.revision)
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    error,
    pending,
    cancel: () => setPending(false),
    request: () => {
      if (input.dirty) setPending(true)
      else void open(input.revision)
    },
    discardAndOpen: () => void open(input.revision),
    saveAndOpen: () => void saveAndOpen(),
  } as const
}
