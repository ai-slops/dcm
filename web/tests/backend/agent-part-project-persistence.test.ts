import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { loadDemo } from "../../server/demo.ts"
import { AgentRunSnapshotSchema, BootstrapSchema } from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("real Part project dispatch", () => {
  it("denies the fixture write by default without persisting a project", async () => {
    // Given
    const fixture = await harness()

    // When
    const run = await fixture.run()

    // Then
    expect(run.status).toBe("failed")
    expect(run.tool_calls?.map((call) => call.tool_id)).toEqual(["list_songs", "create_project"])
    expect(fixture.studio.projects.list().projects).toHaveLength(0)
  })

  it("persists and reads back a project when the browser explicitly allows writes", async () => {
    // Given
    const fixture = await harness()

    // When
    const run = await fixture.run("projects_and_components")

    // Then
    expect(run.status).toBe("completed")
    expect(run.project_mutated).toBe(true)
    expect(run.tool_calls?.map((call) => call.tool_id)).toEqual(["list_songs", "create_project"])
    const summary = fixture.studio.projects.list().projects[0]
    if (summary === undefined) throw new TypeError("Fixture project is missing")
    expect(fixture.studio.projects.read(summary.id).name).toBe("Part fixture rules")
  })
})

async function harness() {
  let toolArguments: object | undefined
  let turns = 0
  const provider = createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      turns += 1
      const message =
        turns === 1
          ? { content: null, tool_calls: [toolCall("songs-1", "list_songs", {})] }
          : turns === 2
            ? {
                content: null,
                tool_calls: [toolCall("create-1", "create_project", toolArguments ?? {})],
              }
            : { content: "Project persisted." }
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end(
        `data: ${JSON.stringify(completion(message, turns <= 2 ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`,
      )
    })
  })
  servers.push(provider)
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve))
  const address = provider.address()
  if (address === null || typeof address === "string")
    throw new TypeError("Provider address missing")
  const root = await mkdtemp(join(tmpdir(), "pump-agent-part-project-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({
      STUDIO_DATA: root,
      STUDIO_REPO_ROOT: repoRoot,
      PART_ENDPOINT: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      PART_MODEL: "fixture-model",
    }),
  )
  const demo = await loadDemo(repoRoot)
  const songId = studio.store.library().songs[0]?.id
  if (songId === undefined) throw new TypeError("Fixture song missing")
  const { audio_sha256: _digest, ...timing } = demo.document.project.music
  toolArguments = {
    song_id: songId,
    mode: "Double",
    name: "Part fixture rules",
    timing,
    evaluation_contract: demo.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: timing.duration_ticks,
      step_ticks: 48,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
  }
  const bootResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootResponse.json())
  const cookie = bootResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const session = studio.sessions.get(bootstrap.session_id)
  if (session === undefined) throw new TypeError("Fixture session missing")
  return {
    studio,
    async run(writeAccess: "read_only" | "projects_and_components" = "read_only") {
      const response = await studio.app.request("http://127.0.0.1:4173/api/v1/agent/runs", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-csrf-token": bootstrap.csrf_token,
        },
        body: JSON.stringify({
          base_revision: bootstrap.document.revision,
          prompt: "Create a durable project",
          write_access: writeAccess,
        }),
      })
      const started = AgentRunSnapshotSchema.parse(await response.json())
      const record = studio.runs.get(session, started.id)
      await record.settled()
      return record.snapshot
    },
  }
}

function toolCall(id: string, name: string, args: object) {
  return { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }
}

function completion(message: object, finishReason: "stop" | "tool_calls") {
  return {
    id: crypto.randomUUID(),
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}
