import { createServer } from "node:http"

import { afterEach, describe, expect, it } from "vitest"

import { createPartRuntime } from "../server/agent/part-runtime.ts"
import type { BeatChartDocument } from "../shared/beat-projects.ts"

const servers = new Set<ReturnType<typeof createServer>>()

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

describe("createPartRuntime", () => {
  it("selects the stateless Responses adapter and its output-token field", async () => {
    // Given
    let requestBody:
      | {
          readonly store?: unknown
          readonly max_output_tokens?: unknown
          readonly max_tokens?: unknown
        }
      | undefined
    const server = createServer((request, response) => {
      const chunks: Uint8Array[] = []
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
      request.on("end", () => {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (typeof parsed === "object" && parsed !== null)
          requestBody = Object.fromEntries(Object.entries(parsed))
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { message: "fixture rejection" } }))
      })
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new TypeError("Missing provider address")
    const runtime = createPartRuntime({
      endpoint: new URL(`http://127.0.0.1:${address.port}/v1/responses`),
      model: "gpt-6.1-sol",
      api: "responses",
      signal: new AbortController().signal,
      project: fixtureProject(),
      evaluateChart: () => Promise.reject(new TypeError("not expected")),
      generateVariant: () => Promise.reject(new TypeError("not expected")),
      proposeChart: () => Promise.reject(new TypeError("not expected")),
      validateUcs: () => Promise.reject(new TypeError("not expected")),
      onToolState: () => undefined,
    })
    if (!runtime.ok) throw new TypeError(runtime.error.message)

    // When
    const started = await runtime.value.start("Inspect")
    if (!started.ok) throw new TypeError(started.error.message)
    await started.value.done
    await runtime.value.dispose()

    // Then
    expect(requestBody?.store).toBe(false)
    expect(requestBody?.max_output_tokens).toBe(4_096)
    expect(requestBody?.max_tokens).toBeUndefined()
  })

  it("runs a real model-tool-final loop through the OpenAI-compatible fetch adapter", async () => {
    // Given
    const requestBodies: unknown[] = []
    const requestUrls: (string | undefined)[] = []
    const authorizationHeaders: (string | undefined)[] = []
    const server = createServer((request, response) => {
      requestUrls.push(request.url)
      authorizationHeaders.push(request.headers.authorization)
      const chunks: Uint8Array[] = []
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
      request.on("end", () => {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        requestBodies.push(body)
        response.setHeader("content-type", "application/json")
        const firstTurn = requestBodies.length === 1
        response.end(
          JSON.stringify({
            id: `fixture-${requestBodies.length}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: firstTurn
                  ? {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "read-1",
                          type: "function",
                          function: { name: "read_document", arguments: "{}" },
                        },
                      ],
                    }
                  : { role: "assistant", content: "Document inspected.", refusal: null },
                finish_reason: firstTurn ? "tool_calls" : "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
        )
      })
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") {
      throw new TypeError("fixture server did not expose a TCP address")
    }
    const project = fixtureProject()
    let toolCalls = 0
    const runtimeResult = createPartRuntime({
      endpoint: new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`),
      model: "fixture-model",
      signal: new AbortController().signal,
      project,
      evaluateChart: () => Promise.reject(new TypeError("evaluate_chart was not expected")),
      generateVariant: () => Promise.reject(new TypeError("generate_variant was not expected")),
      proposeChart: () => Promise.reject(new TypeError("propose_chart was not expected")),
      validateUcs: () => Promise.reject(new TypeError("validate_ucs was not expected")),
      onToolState: (toolId, state) => {
        if (toolId === "read_document" && state === "started") toolCalls += 1
      },
    })
    if (!runtimeResult.ok) {
      throw new TypeError(runtimeResult.error.message)
    }

    // When
    const started = await runtimeResult.value.start("Inspect the current document.")
    if (!started.ok) throw new TypeError(started.error.message)
    const result = await started.value.done
    await runtimeResult.value.dispose()

    // Then
    expect(result.phase).toBe("completed")
    if (result.phase !== "completed") throw new TypeError("fixture Part run did not complete")
    expect(result.text).toBe("Document inspected.")
    expect(toolCalls).toBe(1)
    expect(requestBodies).toHaveLength(2)
    expect(JSON.stringify(requestBodies[1])).toContain('"role":"tool"')
    expect(requestUrls).toEqual(["/v1/chat/completions", "/v1/chat/completions"])
    expect(authorizationHeaders).toEqual([undefined, undefined])
  })
})

function fixtureProject(): BeatChartDocument {
  return {
    schema_version: 1,
    title: "Fixture",
    artist: "PUMP",
    chart_artist: null,
    mode: "Double",
    audio_sha256: "0".repeat(64),
    notes: [],
    timing: {
      schema_version: 1,
      duration: { numerator: 8, denominator: 1 },
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 }],
      offset_micros: 0,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        },
      ],
      reference_accents: [],
    },
    evaluation_contract: {
      schema_version: 2,
      history_policy: { recent_window: 0, max_request_history: 0 },
      foot_model: {
        version: 1,
        micros_per_panel_unit: 100_000,
        bracket_setup_micros: 100_000,
        crossover_penalty: 2,
        bracket_penalty: 3,
      },
      difficulty: {
        label: "fixture",
        density: { minimum: 0, maximum: 1_000_000 },
        movement: { minimum: 0, maximum: 1_000_000 },
        brackets: { minimum: 0, maximum: 1_000_000 },
        hold_occupancy: { minimum: 0, maximum: 1_000_000 },
        local_load: { minimum: 0, maximum: 1_000_000 },
        total: { minimum: 0, maximum: 1_000_000 },
        local_windows: [],
      },
      intents: [],
      budgets: {
        max_notes: 10_000,
        max_frames: 10_000,
        max_dp_work: 1_000_000,
        max_matching_work: 1_000_000,
      },
    },
    audio_asset: { format: "wav", byte_length: 44 },
  }
}
