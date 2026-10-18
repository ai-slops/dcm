import { describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { nativeExecutable } from "../../server/native/service.ts"
import { repoRoot } from "../support/paths.ts"

describe("native bootstrap portability", () => {
  it("selects the Windows executable suffix", () => {
    // Given
    const repoRoot = "C:\\pump"

    // When
    const executable = nativeExecutable(repoRoot, "win32")

    // Then
    expect(executable).toMatch(/pump\.exe$/)
  })

  it("loads an editable four-hold demo from source fixtures", async () => {
    // Given / When
    const demo = await loadDemo(repoRoot)

    // Then
    expect(demo.document.project.chart.notes).toHaveLength(4)
    expect(demo.document.project.chart.notes.every((note) => note.hold_ticks === 4)).toBe(true)
  })
})
