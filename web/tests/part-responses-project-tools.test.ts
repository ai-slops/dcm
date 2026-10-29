import { createServer } from "node:http"

import { afterEach, expect, it } from "vitest"

import { createPartRuntime } from "../server/agent/part-runtime.ts"
import { ProjectAgentTools } from "../server/agent/project-tools.ts"
import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { BeatProjectWorkspaceSchema } from "../shared/beat-projects.ts"
import { ChartIdSchema, SongIdSchema } from "../shared/library.ts"
import { repoRoot } from "./support/paths.ts"

const servers = new Set<ReturnType<typeof createServer>>()

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

it("executes a project tool through the real Responses adapter loop", async () => {
  // Given
  let turns = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      turns += 1
      const output =
        turns === 1
          ? [
              {
                id: "tool-item-1",
                type: "function_call",
                status: "completed",
                call_id: "chart-1",
                name: "read_chart",
                arguments: JSON.stringify({ chart_id: CHART_ID }),
              },
            ]
          : [
              {
                id: "message-1",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Projects inspected." }],
              },
            ]
      const event = {
        type: "response.completed",
        sequence_number: turns,
        response: {
          id: `response-${turns}`,
          object: "response",
          status: "completed",
          output,
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        },
      }
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end(`data: ${JSON.stringify(event)}\n\n`)
    })
  })
  servers.add(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new TypeError("Provider address missing")
  const demo = await loadDemo(repoRoot)
  const source = migrateLegacyChart(demo.document.project)
  let toolCalls = 0
  const runtime = createPartRuntime({
    endpoint: new URL(`http://127.0.0.1:${address.port}/v1/responses`),
    model: "fixture-model",
    api: "responses",
    signal: new AbortController().signal,
    project: source,
    projectTools: new ProjectAgentTools({
      service: {
        list: () =>
          BeatProjectWorkspaceSchema.parse({
            revision: 0,
            selected_project_id: null,
            projects: [],
            components: [],
          }),
        songs: () => [],
        baseSources: () => [],
        chart: () => ({
          chart: {
            id: CHART_ID,
            song_id: SONG_ID,
            name: "Main",
            mode: source.mode,
            note_count: demo.document.project.chart.notes.length,
            hold_count: demo.document.project.chart.notes.filter((note) => note.hold_ticks > 0)
              .length,
            duration: source.timing.duration,
            chart_artist: source.chart_artist,
          },
          song: {
            id: SONG_ID,
            title: demo.document.project.title,
            artist: demo.document.project.artist,
            audio: {
              ...demo.document.project.audio_asset,
              sha256: Buffer.from(demo.document.project.music.audio_sha256).toString("hex"),
            },
          },
          project: source,
        }),
        read: () => {
          throw new TypeError("not expected")
        },
        component: () => {
          throw new TypeError("not expected")
        },
        command: async () => Promise.reject(new TypeError("not expected")),
      },
      writeAccess: "read_only",
      signal: new AbortController().signal,
      onMutation: () => undefined,
    }),
    evaluateChart: () => Promise.reject(new TypeError("not expected")),
    generateVariant: () => Promise.reject(new TypeError("not expected")),
    proposeChart: () => Promise.reject(new TypeError("not expected")),
    validateUcs: () => Promise.reject(new TypeError("not expected")),
    onToolState: (toolId, state) => {
      if (toolId === "read_chart" && state === "completed") toolCalls += 1
    },
  })
  if (!runtime.ok) throw new TypeError(runtime.error.message)

  // When
  const started = await runtime.value.start("Inspect projects")
  if (!started.ok) throw new TypeError(started.error.message)
  const result = await started.value.done
  await runtime.value.dispose()

  // Then
  expect(result).toEqual({ phase: "completed", text: "Projects inspected." })
  expect(toolCalls).toBe(1)
  expect(turns).toBe(2)
})

const CHART_ID = ChartIdSchema.parse("00000000-0000-4000-8000-000000000003")
const SONG_ID = SongIdSchema.parse("00000000-0000-4000-8000-000000000002")
