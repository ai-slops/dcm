import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ProjectAgentTools } from "../../server/agent/project-tools.ts"
import { loadDemo } from "../../server/demo.ts"
import { ProjectService } from "../../server/projects/service.ts"
import { StudioStore } from "../../server/store.ts"
import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import { GenerationProjectIdSchema } from "../../shared/project-identities.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("agent project persistence", () => {
  it("discovers durable songs and reads a chart without project write access", async () => {
    // Given
    const fixture = await harness("read_only")
    const chartId = fixture.store.library().active_chart_id

    // When
    const songs = fixture.tools.listSongs()
    const chart = fixture.tools.readChart({ chart_id: chartId })

    // Then
    expect(songs.songs[0]?.id).toBe(fixture.songId)
    expect(chart.chart.id).toBe(chartId)
    expect(chart.project.notes).toEqual(fixture.store.document().project.notes)
  })

  it("persists an allowed project creation through the real project service", async () => {
    // Given
    const fixture = await harness()

    // When
    const receipt = await fixture.tools.createProject(await createInput(fixture))

    // Then
    const persisted = fixture.service.read(GenerationProjectIdSchema.parse(receipt.entity.id))
    expect(persisted.name).toBe("Agent rules")
    expect(fixture.service.list().selected_project_id).toBe(persisted.id)
  })

  it("reports the actual revision when a durable CAS write is stale", async () => {
    // Given
    const fixture = await harness()
    const created = await createProject(fixture)
    const input = writeInput(created, "First write")
    await fixture.tools.writeProject(input)

    // When / Then
    await expect(fixture.tools.writeProject(input)).rejects.toMatchObject({
      code: "project_revision_conflict",
      currentRevision: 1,
    })
  })

  it("prevents a cancelled queued write inside the real store transaction", async () => {
    // Given
    const fixture = await harness()
    const created = await createProject(fixture)
    const gate = deferred<void>()
    const blocking = fixture.store.transact(undefined, async (state) => {
      await gate.promise
      return { state, result: undefined }
    })
    const abort = new AbortController()
    const pending = fixture.service.command(
      { type: "write_project", ...writeInput(created, "Cancelled write") },
      abort.signal,
    )

    // When
    abort.abort("cancelled")
    gate.resolve()
    await blocking

    // Then
    await expect(pending).rejects.toBe("cancelled")
    expect(fixture.service.read(created.id).revision).toBe(created.revision)
  })
})

async function harness(
  writeAccess: "read_only" | "projects_and_components" = "projects_and_components",
) {
  const root = await mkdtemp(join(tmpdir(), "pump-agent-projects-"))
  roots.push(root)
  const demo = await loadDemo(repoRoot)
  const store = await StudioStore.open(root, demo.document, demo.audio)
  const service = new ProjectService(store, {
    generate: async () => Promise.reject(new TypeError("not expected")),
  })
  return {
    store,
    service,
    songId: store.library().songs[0]?.id,
    tools: new ProjectAgentTools({
      service,
      writeAccess,
      signal: new AbortController().signal,
      onMutation: () => undefined,
    }),
  }
}

async function createInput(fixture: Awaited<ReturnType<typeof harness>>) {
  const songId = fixture.songId
  if (songId === undefined) throw new TypeError("Fixture song is missing")
  const source = fixture.store.document().project
  return {
    song_id: songId,
    mode: "Double" as const,
    name: "Agent rules",
    chart_artist: "Agent fixture author",
    base_ucs_ref: {
      source: "saved_chart" as const,
      chart_id: fixture.store.library().active_chart_id,
    },
    timing: source.timing,
    evaluation_contract: source.evaluation_contract,
    generation_rules: {
      schema_version: 1 as const,
      algorithm: "weighted_cycle_v1" as const,
      start: { numerator: 0, denominator: 1 },
      end: { numerator: 8, denominator: 1 },
      step: { numerator: 12, denominator: 1 },
      pattern: [
        { choices: [{ panel_mask: 1, hold: { numerator: 0, denominator: 1 }, weight: 1 }] },
      ],
    },
  }
}

async function createProject(fixture: Awaited<ReturnType<typeof harness>>) {
  const receipt = await fixture.tools.createProject(await createInput(fixture))
  return fixture.service.read(GenerationProjectIdSchema.parse(receipt.entity.id))
}

function writeInput(project: GenerationProjectV2, name: string) {
  return {
    project_id: project.id,
    base_revision: project.revision,
    name,
    chart_artist: project.chart_artist,
    timing: project.timing,
    evaluation_contract: project.evaluation_contract,
    generation_rules: project.generation_rules,
  }
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (resolveValue === undefined) throw new TypeError("Deferred promise is not initialized")
      resolveValue(value)
    },
  }
}
