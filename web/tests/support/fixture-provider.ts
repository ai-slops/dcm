import { createServer, type Server } from "node:http"

import { z } from "zod"

import { canonicalizeChart, StudioProjectV1Schema } from "../../shared/index.ts"

const RequestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
})

export type FixtureProviderOptions = {
  readonly delayToolResponse?: Promise<void>
}

export async function startFixtureProvider(
  port = 0,
  options: FixtureProviderOptions = {},
): Promise<{
  readonly server: Server
  readonly endpoint: URL
}> {
  const server = createServer((request, response) => {
    const chunks: Uint8Array[] = []
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
    request.on("end", () => {
      void respond()
    })

    async function respond(): Promise<void> {
      const body = RequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      const toolMessages = body.messages.filter((message) => message.role === "tool")
      if (toolMessages.length > 0) await options.delayToolResponse
      const payload = toolMessages.length === 0 ? readDocumentCall() : nextAfterTool(toolMessages)
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
    }
  })
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new TypeError("Fixture provider has no TCP address")
  return { server, endpoint: new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`) }
}

function readDocumentCall() {
  return completion(
    {
      content: null,
      tool_calls: [toolCall("read-1", "read_document", {})],
    },
    "tool_calls",
  )
}

function nextAfterTool(messages: readonly { readonly role: string; readonly content: unknown }[]) {
  const proposed = messages.some(
    (message) => typeof message.content === "string" && message.content.includes("proposal_id"),
  )
  if (proposed) return completion({ content: "Proposal ready." }, "stop")
  const last = messages.at(-1)
  const project = typeof last?.content === "string" ? JSON.parse(last.content) : undefined
  const parsed = StudioProjectV1Schema.parse(project)
  const notes =
    parsed.chart.notes.length === 0
      ? [{ tick: 0, panel_mask: 1, hold_ticks: 0 }]
      : parsed.chart.notes.map((note) => ({ ...note, panel_mask: mirrorMask(note.panel_mask) }))
  const chart = canonicalizeChart({ ...parsed.chart, notes })
  return completion(
    {
      content: null,
      tool_calls: [
        toolCall("proposal-1", "propose_chart", {
          summary: "Fixture proposal",
          chart,
        }),
      ],
    },
    "tool_calls",
  )
}

function mirrorMask(mask: number): number {
  let mirrored = 0
  for (let panel = 0; panel < 10; panel += 1) {
    if ((mask & (1 << panel)) !== 0) mirrored |= 1 << (9 - panel)
  }
  return mirrored
}

function completion(message: object, finishReason: "stop" | "tool_calls") {
  return {
    id: crypto.randomUUID(),
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function toolCall(id: string, name: string, args: object) {
  return { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }
}

if (import.meta.main) {
  const { FIXTURE_PROVIDER_PORT: fixtureProviderPort } = process.env
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .parse(fixtureProviderPort ?? 4199)
  const fixture = await startFixtureProvider(port)
  process.stdout.write(`Test-only Part fixture provider: ${fixture.endpoint.toString()}\n`)
}
