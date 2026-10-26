import { fail, isJsonObject, ok } from "@slop-lab/part/contracts/index.js"
import type { Model } from "@slop-lab/part/reference/index.js"
import { createOpenAIResponsesAdapter } from "@slop-lab/part-plugins/providers/openai-responses/index.js"

const MAX_FRAME_BYTES = 1024 * 1024

/** DIM adds an out-of-band event that Part 0.1.0 does not recognize. */
export function createStudioResponsesAdapter(): Model.Adapter {
  const adapter = createOpenAIResponsesAdapter()
  return {
    ...adapter,
    createDecoder(response) {
      const created = adapter.createDecoder(response)
      const media = Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === "content-type",
      )?.[1]
      if (!created.ok || (media !== undefined && !media.startsWith("text/event-stream")))
        return created
      const decoder = created.value
      let pending: Buffer = Buffer.alloc(0)
      let failed = false
      return ok({
        push(chunk) {
          if (failed) return fail("studio.responses.failed", "Response decoder already failed")
          pending = Buffer.concat([pending, chunk])
          const events: Model.ProviderEvent[] = []
          let boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending.toString("latin1"))
          while (boundary !== null) {
            const end = boundary.index + boundary[0].length
            const frame = pending.subarray(0, end)
            pending = pending.subarray(end)
            if (frame.byteLength > MAX_FRAME_BYTES) {
              failed = true
              return fail("studio.responses.frame_limit", "Response frame exceeded its limit")
            }
            if (!isRouterMetadata(frame)) {
              const pushed = decoder.push(frame)
              if (!pushed.ok) {
                failed = true
                return pushed
              }
              events.push(...pushed.value)
            }
            boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending.toString("latin1"))
          }
          if (pending.byteLength > MAX_FRAME_BYTES) {
            failed = true
            return fail("studio.responses.frame_limit", "Response frame exceeded its limit")
          }
          return ok(events)
        },
        finish() {
          if (failed) return fail("studio.responses.failed", "Response decoder already failed")
          if (pending.byteLength > 0) {
            const pushed = decoder.push(pending)
            if (!pushed.ok) return pushed
          }
          return decoder.finish()
        },
      })
    },
  }
}

function isRouterMetadata(frame: Uint8Array): boolean {
  const lines = Buffer.from(frame)
    .toString("utf8")
    .split(/\r\n|\r|\n/)
  const names = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trim())
  if (names.length > 1 || (names[0] !== undefined && names[0] !== "response.metadata")) return false
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5))
    .join("\n")
  try {
    const value: unknown = JSON.parse(data)
    if (!isJsonObject(value)) return false
    const { type } = value
    return type === "response.metadata"
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}
