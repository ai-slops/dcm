import { isJsonObject, ok, schema } from "@slop-lab/part/contracts/index.js"
import { bearerAuth, createFetchTransport, noAuth } from "@slop-lab/part/model/index.js"
import type { Contracts, Model, Runtime } from "@slop-lab/part/reference/index.js"
import { functionTool } from "@slop-lab/part/tools.js"
import { createAgent } from "@slop-lab/part-plugins/agent/index.js"
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js"
import { z } from "zod"

import {
  type EvaluationResponse,
  EvaluationResponseSchema,
  type NativeChart,
  NativeChartSchema,
  type StudioProjectV1,
  StudioProjectV1Schema,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"

export type PartRuntimeOptions = {
  readonly endpoint: URL
  readonly model: string
  readonly apiKey?: string
  readonly signal: AbortSignal
  readonly project: StudioProjectV1
  readonly evaluateChart: (signal: AbortSignal) => Promise<EvaluationResponse>
  readonly generateVariant: (seed: string, signal: AbortSignal) => Promise<NativeChart>
  readonly proposeChart: (input: ProposalInput, signal: AbortSignal) => Promise<ProposalOutput>
  readonly onToolState: (toolId: string, state: "started" | "completed") => void
}

export type ProposalInput = { readonly summary: string; readonly chart: NativeChart }
export type ProposalOutput = { readonly proposal_id: string }

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

const EmptySchema = schema<Readonly<Record<string, never>>>(
  "pump-studio/empty",
  (value): value is Readonly<Record<string, never>> =>
    isJsonObject(value) && Object.keys(value).length === 0,
)
const ProjectSchema = partSchema("pump-studio/project", StudioProjectV1Schema)
const EvaluationSchema = partSchema("pump-studio/evaluation", EvaluationResponseSchema)
const ChartSchema = partSchema("pump-studio/chart", NativeChartSchema)
const SeedInput = z.strictObject({ seed: z.string().regex(/^[0-9a-f]{64}$/) }).readonly()
const SeedSchema = partSchema("pump-studio/seed", SeedInput)
const ProposalInputZod = z
  .strictObject({ summary: z.string().min(1).max(1_024), chart: NativeChartSchema })
  .readonly()
const ProposalSchema = partSchema("pump-studio/proposal", ProposalInputZod)
const ProposalOutputZod = z.strictObject({ proposal_id: z.string().min(1) }).readonly()
const ProposalOutputSchema = partSchema("pump-studio/proposal-output", ProposalOutputZod)

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
  ]
  const created = createAgent({
    model: {
      profile: {
        id: "pump-studio",
        revision: "1",
        adapterId: "part/openai-compatible",
        transportId: "part/fetch",
        authStrategyId: options.apiKey === undefined ? "none" : "bearer",
        model: options.model,
        endpoint: options.endpoint.toString(),
        defaults: { stream: true, max_tokens: 4_096 },
        capabilities: { revision: "1", entries: [] },
      },
      adapter: createOpenAICompatibleAdapter(),
      transport: createFetchTransport({ allowedOrigins: [options.endpoint.origin] }),
      auth: options.apiKey === undefined ? noAuth : bearerAuth(() => options.apiKey ?? ""),
    },
    tools,
    toolSchemas: {
      read_document: objectSchema({}),
      evaluate_chart: objectSchema({}),
      generate_variant: objectSchema({ seed: { type: "string", pattern: "^[0-9a-f]{64}$" } }, [
        "seed",
      ]),
      propose_chart: objectSchema(
        {
          summary: { type: "string", minLength: 1, maxLength: 1_024 },
          chart: chartJsonSchema(),
        },
        ["summary", "chart"],
      ),
    },
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
): (input: I, context: { readonly signal: AbortSignal }) => Promise<O> {
  return async (input, context) => {
    options.onToolState(toolId, "started")
    const result = await operation(input, AbortSignal.any([context.signal, options.signal]))
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_TOOL_OUTPUT_BYTES) {
      throw new StudioError(500, "agent_tool_output_limit", "Agent tool output exceeded its limit")
    }
    options.onToolState(toolId, "completed")
    return result
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

function partSchema<T>(id: string, validator: z.ZodType<T>): Contracts.Schema<T> {
  return schema(id, (value): value is T => validator.safeParse(value).success)
}

function objectSchema(
  properties: Readonly<Record<string, Contracts.Json>>,
  required: readonly string[] = [],
): Contracts.Json {
  return { type: "object", properties, required, additionalProperties: false }
}

function chartJsonSchema(): Contracts.Json {
  return {
    type: "object",
    required: ["ticks_per_beat", "span_ticks", "notes"],
    additionalProperties: false,
    properties: {
      ticks_per_beat: { type: "integer", minimum: 1, maximum: 4_096 },
      span_ticks: { type: "integer", minimum: 1, maximum: 1_000_000 },
      notes: {
        type: "array",
        maxItems: 10_000,
        items: {
          type: "object",
          required: ["tick", "panel_mask", "hold_ticks"],
          additionalProperties: false,
          properties: {
            tick: { type: "integer", minimum: 0 },
            panel_mask: { type: "integer", minimum: 1, maximum: 1_023 },
            hold_ticks: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  }
}

const TextDeltaSchema = z.strictObject({ text: z.string() })
