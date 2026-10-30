import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  formatOffsetMilliseconds,
  parseOffsetMilliseconds,
} from "../src/domain/offset-milliseconds.ts"
import { OffsetMillisecondsField } from "../src/ui/OffsetMillisecondsField.tsx"

describe("millisecond offset input", () => {
  it.each([
    ["100", 100_000],
    ["-1.25", -1_250],
    [".001", 1],
    ["0", 0],
    ["9007199254740.991", Number.MAX_SAFE_INTEGER],
  ])("converts %s milliseconds to exact integer microseconds", (draft, offsetMicros) => {
    expect(parseOffsetMilliseconds(String(draft))).toEqual({ kind: "valid", offsetMicros })
  })

  it.each(["", "1e3", "0.0001", "NaN", "9007199254740.992"])(
    "rejects %s without rounding",
    (draft) => {
      expect(parseOffsetMilliseconds(draft).kind).toBe("invalid")
    },
  )

  it("formats signed offsets without losing microsecond precision", () => {
    expect(formatOffsetMilliseconds(-1_250)).toBe("-1.25")
    expect(formatOffsetMilliseconds(Number.MAX_SAFE_INTEGER)).toBe("9007199254740.991")
  })

  it("labels the editor field in milliseconds rather than storage units", () => {
    const markup = renderToStaticMarkup(
      createElement(OffsetMillisecondsField, {
        offsetMicros: -1_250,
        onChange: () => undefined,
      }),
    )
    expect(markup).toContain("Audio offset (ms)")
    expect(markup).toContain('value="-1.25"')
    expect(markup).not.toContain("microseconds")
  })
})
