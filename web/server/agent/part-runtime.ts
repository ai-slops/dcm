import { ok } from "@slop-lab/part/contracts/index.js"
import { bearerAuth, createFetchTransport, noAuth } from "@slop-lab/part/model/index.js"
import type { Contracts, Model, Runtime, Tools } from "@slop-lab/part/reference/index.js"
import { functionTool } from "@slop-lab/part/tools.js"
import { createAgent } from "@slop-lab/part-plugins/agent/index.js"
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js"
import type {
  EvaluationResponse,
  NativeChart,
  NativeMusic,
  StudioProjectV1,
} from "../../shared/index.ts"
import { truncateUtf8 } from "../../shared/text.ts"
import { StudioError } from "../errors.ts"
import {
  ChartSchema,
  EmptySchema,
  EvaluationSchema,
  ProjectSchema,
  ProposalOutputSchema,
  ProposalSchema,
  SeedSchema,
  TextDeltaSchema,
  toolJsonSchemas,
  UcsInputSchema,
  UcsOutputSchema,
} from "./part-schemas.ts"
import { createStudioResponsesAdapter } from "./responses-adapter.ts"

export type PartRuntimeOptions = {
  readonly endpoint: URL
  readonly model: string
  readonly apiKey?: string
  readonly api?: "chat" | "responses"
  readonly signal: AbortSignal
  readonly project: StudioProjectV1
  readonly evaluateChart: (signal: AbortSignal) => Promise<EvaluationResponse>
  readonly generateVariant: (seed: string, signal: AbortSignal) => Promise<NativeChart>
  readonly proposeChart: (input: ProposalInput, signal: AbortSignal) => Promise<ProposalOutput>
  readonly validateUcs: (
    mode: "Single" | "Double",
    signal: AbortSignal,
  ) => Promise<ValidateUcsOutput>
  readonly onToolState: (
    toolId: string,
    state: "started" | "completed" | "failed",
    detail: ToolStateDetail,
  ) => void
}

export type ProposalInput = {
  readonly summary: string
  readonly chart: NativeChart
  readonly music?: NativeMusic | undefined
}
export type ProposalOutput = { readonly proposal_id: string }
export type ValidateUcsOutput = {
  readonly valid: true
  readonly mode: "Single" | "Double"
  readonly byte_length: number
}
type ToolStateDetail = {
  readonly call_id: string
  readonly input_preview: string
  readonly output_preview?: string
  readonly error?: { readonly code: string; readonly message: string }
  readonly truncated?: boolean
}

export type PartRun = {
  readonly done: Promise<PartOutcome>
  readonly observe: () => AsyncIterable<PartTextDelta>
  readonly cancel: (reason: string) => Promise<void>
}

export type PartOutcome =
  | { readonly phase: "completed"; readonly text: string }
  | { readonly phase: "cancelled" }
  | { readonly phase: "failed"; readonly code: string; readonly message: string }

export type PartTextDelta = { readonly text: string }

export type PartRuntime = {
  readonly start: (prompt: string) => Promise<Contracts.Result<PartRun>>
  readonly dispose: () => Promise<void>
}

export type PartRuntimeFactory = (options: PartRuntimeOptions) => Contracts.Result<PartRuntime>

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024

export const createPartRuntime: PartRuntimeFactory = (options) => {
  const tools = [
    functionTool({
      id: "read_document",
      description: "Read the frozen PUMP Studio project for this run.",
      input: EmptySchema,
      output: ProjectSchema,
      execute: withTool(options, "read_document", (_input, _signal) => options.project),
    }),
    functionTool({
      id: "evaluate_chart",
      description: "Evaluate the frozen chart with the native finite model.",
      input: EmptySchema,
      output: EvaluationSchema,
      execute: withTool(options, "evaluate_chart", (_input, signal) =>
        options.evaluateChart(signal),
      ),
    }),
    functionTool({
      id: "generate_variant",
      description: "Generate one native chart variant for a lowercase 64-hex seed.",
      input: SeedSchema,
      output: ChartSchema,
      execute: withTool(options, "generate_variant", (input, signal) =>
        options.generateVariant(input.seed, signal),
      ),
    }),
    functionTool({
      id: "propose_chart",
      description: "Create a reviewable proposal. This never edits the saved document.",
      input: ProposalSchema,
      output: ProposalOutputSchema,
      effects: "write",
      execute: withTool(options, "propose_chart", (input, signal) =>
        options.proposeChart(input, signal),
      ),
    }),
    functionTool({
      id: "validate_ucs",
      description:
        "Validate that the frozen project can be exported as native UCS in the requested mode.",
      input: UcsInputSchema,
      output: UcsOutputSchema,
      execute: withTool(options, "validate_ucs", (input, signal) =>
        options.validateUcs(input.mode, signal),
      ),
    }),
  ]
  const responses = options.api === "responses"
  const created = createAgent({
    model: {
      profile: {
        id: "pump-studio",
        revision: "1",
        adapterId: responses ? "part/openai-responses" : "part/openai-compatible",
        transportId: "part/fetch",
        authStrategyId: options.apiKey === undefined ? "none" : "bearer",
        model: options.model,
        endpoint: options.endpoint.toString(),
        defaults: responses
          ? { stream: true, max_output_tokens: 4_096 }
          : { stream: true, max_tokens: 4_096 },
        capabilities: { revision: "1", entries: [] },
      },
      adapter: responses ? createStudioResponsesAdapter() : createOpenAICompatibleAdapter(),
      transport: createFetchTransport({ allowedOrigins: [options.endpoint.origin] }),
      auth: options.apiKey === undefined ? noAuth : bearerAuth(() => options.apiKey ?? ""),
    },
    tools,
    toolSchemas: toolJsonSchemas,
    limits: {
      maxModelInvocations: 8,
      maxToolDispatches: 16,
      maxExecutorAttempts: 24,
      maxKnownTokens: 100_000,
    },
  })
  if (!created.ok) return created
  return ok({
    async start(prompt) {
      const started = await created.value.start(prompt)
      if (!started.ok) return started
      return ok({
        done: started.value.done.then(normalizeOutcome),
        observe: () => observeText(started.value),
        async cancel(reason) {
          await started.value.requestCancel(reason)
        },
      })
    },
    async dispose() {
      await created.value.dispose()
    },
  })
}

function withTool<I, O>(
  options: PartRuntimeOptions,
  toolId: string,
  operation: (input: I, signal: AbortSignal) => Promise<O> | O,
): (input: I, context: Tools.ExecutionContext) => Promise<O> {
  return async (input, context) => {
    const inputPreview = preview(input)
    const callId = context.operationId
    options.onToolState(toolId, "started", {
      call_id: callId,
      input_preview: inputPreview.text,
      ...(inputPreview.truncated ? { truncated: true } : {}),
    })
    try {
      const result = await operation(input, AbortSignal.any([context.signal, options.signal]))
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_TOOL_OUTPUT_BYTES) {
        throw new StudioError(
          500,
          "agent_tool_output_limit",
          "Agent tool output exceeded its limit",
        )
      }
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

async function* observeText(
  handle: Runtime.ExecutionHandle<Model.Response>,
): AsyncIterable<PartTextDelta> {
  for await (const update of handle.observe()) {
    if (update.kind !== "data" || update.type !== "text-delta") continue
    const parsed = TextDeltaSchema.safeParse(update.payload)
    if (parsed.success) yield parsed.data
  }
}

function normalizeOutcome(outcome: Runtime.ManagedOutcome<Model.Response>): PartOutcome {
  if (outcome.phase === "completed") {
    return {
      phase: "completed",
      text: outcome.result.content
        .filter((part) => part.kind === "text")
        .map((part) => part.text)
        .join(""),
    }
  }
  if (outcome.phase === "cancelled") return { phase: "cancelled" }
  return { phase: "failed", code: outcome.error.code, message: outcome.error.message }
}

function preview(value: unknown): { readonly text: string; readonly truncated: boolean } {
  const text = JSON.stringify(value)
  const bytes = Buffer.from(text, "utf8")
  if (bytes.byteLength <= 8_192) return { text, truncated: false }
  return { text: truncateUtf8(text, 8_192), truncated: true }
}
