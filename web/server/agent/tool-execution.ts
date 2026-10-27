import type { Tools } from "@slop-lab/part/reference/index.js"

import { truncateUtf8 } from "../../shared/text.ts"
import { StudioError } from "../errors.ts"
import type { PartRuntimeOptions, ToolStateDetail } from "./part-runtime.ts"

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024

export function withTool<I, O>(
  options: PartRuntimeOptions,
  toolId: string,
  operation: (input: I, signal: AbortSignal) => Promise<O> | O,
): (input: I, context: Tools.ExecutionContext) => Promise<O> {
  return async (input, context) => {
    const inputPreview = preview(input)
    const callId = context.operationId
    options.onToolState(toolId, "started", toolDetail(callId, inputPreview))
    try {
      const signal = AbortSignal.any([context.signal, options.signal])
      if (signal.aborted) throw new StudioError(409, "run_cancelled", "Run is no longer active")
      const result = await operation(input, signal)
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_TOOL_OUTPUT_BYTES)
        throw new StudioError(
          500,
          "agent_tool_output_limit",
          "Agent tool output exceeded its limit",
        )
      const outputPreview = preview(result)
      options.onToolState(toolId, "completed", {
        call_id: callId,
        input_preview: inputPreview.text,
        output_preview: outputPreview.text,
        ...(inputPreview.truncated || outputPreview.truncated ? { truncated: true } : {}),
      })
      return result
    } catch (error) {
      const safe =
        error instanceof StudioError
          ? { code: error.code, message: error.message }
          : { code: "tool_failed", message: "Tool execution failed" }
      options.onToolState(toolId, "failed", {
        call_id: callId,
        input_preview: inputPreview.text,
        error: safe,
        ...(inputPreview.truncated ? { truncated: true } : {}),
      })
      throw error
    }
  }
}

function toolDetail(
  callId: string,
  inputPreview: { readonly text: string; readonly truncated: boolean },
): ToolStateDetail {
  return {
    call_id: callId,
    input_preview: inputPreview.text,
    ...(inputPreview.truncated ? { truncated: true } : {}),
  }
}

function preview(value: unknown): { readonly text: string; readonly truncated: boolean } {
  const text = JSON.stringify(value)
  const bytes = Buffer.from(text, "utf8")
  if (bytes.byteLength <= 8_192) return { text, truncated: false }
  return { text: truncateUtf8(text, 8_192), truncated: true }
}
