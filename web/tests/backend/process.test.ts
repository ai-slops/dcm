import { describe, expect, it } from "vitest"

import { ProcessPool } from "../../server/native/process.ts"

describe("ProcessPool cancellation", () => {
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
