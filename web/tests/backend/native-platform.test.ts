import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { NativeService, nativeExecutable } from "../../server/native/service.ts"
import type { AudioRecord } from "../../server/store.ts"
import { StudioProjectV1Schema } from "../../shared/project.ts"
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

  it("rejects Single legacy WASM generation before native readiness", async () => {
    const demo = await loadDemo(repoRoot)
    const native = new NativeService("/missing-native-repo", "/missing-native-data")
    const project = StudioProjectV1Schema.parse({
      ...demo.document.project,
      ucs_mode: "Single",
    })

    const result = native.generate(project, audioRecord(demo.audio), "0".repeat(64))

    await expect(result).rejects.toMatchObject({
      status: 422,
      code: "legacy_single_generation",
      message: "Single charts must be generated from a rule project",
    })
  })

  it("rejects Single Pump Double SSC export before native readiness", async () => {
    const demo = await loadDemo(repoRoot)
    const native = new NativeService("/missing-native-repo", "/missing-native-data")
    const project = StudioProjectV1Schema.parse({
      ...demo.document.project,
      ucs_mode: "Single",
    })

    const result = native.export(project, audioRecord(demo.audio))

    await expect(result).rejects.toMatchObject({
      status: 422,
      code: "legacy_single_ssc_export",
      message: "Single charts cannot be exported as Pump Double SSC; use UCS export",
    })
  })
})

function audioRecord(bytes: Uint8Array): AudioRecord {
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    format: "wav",
  }
}
