export function parseOffsetMilliseconds(
  draft: string,
):
  | { readonly kind: "valid"; readonly offsetMicros: number }
  | { readonly kind: "invalid"; readonly message: string } {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d{1,3}))?|\.(\d{1,3}))$/.exec(draft.trim())
  if (match === null)
    return { kind: "invalid", message: "Enter milliseconds with at most three decimal places." }
  const whole = BigInt(match[2] ?? "0")
  const fractional = BigInt((match[3] ?? match[4] ?? "").padEnd(3, "0"))
  const magnitude = whole * 1_000n + fractional
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER))
    return { kind: "invalid", message: "Audio offset exceeds the supported exact range." }
  return { kind: "valid", offsetMicros: Number(match[1] === "-" ? -magnitude : magnitude) }
}

export function formatOffsetMilliseconds(offsetMicros: number): string {
  const value = BigInt(offsetMicros)
  const magnitude = value < 0n ? -value : value
  const fraction = (magnitude % 1_000n).toString().padStart(3, "0").replace(/0+$/, "")
  return `${value < 0n ? "-" : ""}${magnitude / 1_000n}${fraction === "" ? "" : `.${fraction}`}`
}
