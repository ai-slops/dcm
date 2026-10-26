import { describe, expect, it } from "vitest"

import { ProcessPool } from "../../server/native/process.ts"

describe("ProcessPool cancellation", () => {
  it("distinguishes exact timing capacity from an invalid chart", async () => {
    // Given
    const pool = new ProcessPool(1)
    const diagnostic = JSON.stringify({
      ok: false,
      error: "assessment: fraction arithmetic overflow",
    })
    // When
    const result = pool.run(process.execPath, [
      "-e",
      `process.stderr.write(${JSON.stringify(diagnostic)});process.exit(1)`,
    ])
    // Then
    await expect(result).rejects.toMatchObject({ code: "timing_capacity_exceeded" })
  })

  it("reports bounded structured UCS rejections without exposing arbitrary stderr", async () => {
    // Given
    const pool = new ProcessPool(1, 1, true)
    const diagnostic = JSON.stringify({ ok: false, error: "UCS line 7: unfinished hold" })
    // When
    const result = pool.run(process.execPath, [
      "-e",
      `process.stderr.write(${JSON.stringify(diagnostic)});process.exit(1)`,
    ])
    // Then
    await expect(result).rejects.toMatchObject({
      code: "ucs_rejected",
      message: "UCS line 7: unfinished hold",
    })
  })

  it("keeps non-UCS native diagnostics private", async () => {
    // Given
    const pool = new ProcessPool(1, 1, true)
    // When
    const result = pool.run(process.execPath, [
      "-e",
      'process.stderr.write(JSON.stringify({ok:false,error:"private filesystem details"}));process.exit(1)',
    ])
    // Then
    await expect(result).rejects.toMatchObject({
      code: "native_failed",
      message: "Native operation rejected the input",
    })
  })

  it("does not spawn an operation whose signal is already aborted", async () => {
    // Given
    const controller = new AbortController()
    controller.abort()
    const pool = new ProcessPool(1)

    // When
    const result = pool.run("definitely-not-a-real-executable", [], controller.signal)

    // Then
    await expect(result).rejects.toMatchObject({ code: "cancelled" })
  })
})
