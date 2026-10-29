import { describe, expect, it } from "vitest"

import { formatBeat, parseBeatDraft } from "../src/domain/beat-input.ts"

describe("project beat inputs", () => {
  it("parses and formats reduced exact fractions without decimal conversion", () => {
    // Given / When
    const parsed = parseBeatDraft("14/8")

    // Then
    expect(parsed).toEqual({ kind: "success", beat: { numerator: 7, denominator: 4 } })
    if (parsed.kind === "success") expect(formatBeat(parsed.beat)).toBe("7/4")
  })

  it("keeps an invalid draft visible through a typed adjacent error", () => {
    // Given / When / Then
    expect(parseBeatDraft("1.5")).toEqual({
      kind: "error",
      message: "Enter a beat as a whole number or fraction such as 7/4",
    })
  })
})
