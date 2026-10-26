export const MAX_AGENT_TEXT_BYTES = 65_536
export const MAX_AGENT_DELTA_BYTES = 8_192

export function truncateUtf8(text: string, maximum: number): string {
  const bytes = new TextEncoder().encode(text)
  return bytes.byteLength <= maximum
    ? text
    : new TextDecoder().decode(bytes.subarray(0, maximum), { stream: true })
}
