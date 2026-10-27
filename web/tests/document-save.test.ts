import { describe, expect, it, vi } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { studioApi } from "../src/api/client.ts"
import { useDocumentSave } from "../src/ui/useDocumentSave.ts"
import { repoRoot } from "./support/paths.ts"

describe("document save result", () => {
  it("reports an older saved draft without replacing the newer browser project", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const newerProject = { ...demo.document.project, title: "Newer browser draft" }
    vi.spyOn(studioApi, "save").mockResolvedValue(demo.document)
    const onProject = vi.fn()
    const onStatus = vi.fn()
    const save = useDocumentSave({
      csrfToken: "csrf",
      project: demo.document.project,
      projectRef: { current: newerProject },
      revision: demo.document.revision,
      onProject,
      onPersistedProject: vi.fn(),
      onRevision: vi.fn(),
      onStatus,
      onValidationError: vi.fn(),
    })

    // When
    const result = await save()

    // Then
    expect(result?.kind).toBe("saved_older")
    expect(onProject).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith("Saved older draft")
  })
})
