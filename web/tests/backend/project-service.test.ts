import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { loadDemo } from "../../server/demo.ts"
import { NativeUcsService } from "../../server/native/ucs.ts"
import { ProjectService } from "../../server/projects/service.ts"
import { StudioStore } from "../../server/store.ts"
import { BootstrapSchema } from "../../shared/index.ts"
import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ProjectService", () => {
  it("rejects exporting a canonical chart under a different mode", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const native = new NativeUcsService(repoRoot)

    // When / Then
    expect(() => native.export(demo.document.project, "Single")).toThrowError(
      "UCS export mode must match the chart",
    )
  })

  it("rejects a mismatched mode through the authenticated UCS export route", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-project-ucs-route-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )
    const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
    const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""

    // When
    const response = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": bootstrap.csrf_token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ base_revision: bootstrap.document.revision, mode: "Single" }),
    })

    // Then
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "chart_mode_immutable" } })
  })

  it("creates a durable project and rejects a stale write", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-project-service-"))
    roots.push(root)
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const service = new ProjectService(store, {
      generate: () => Promise.reject(new Error("generation not expected")),
    })
    const song = store.library().songs[0]
    if (song === undefined) throw new Error("Expected initial song")
    const create = ProjectCommandSchema.parse({
      type: "create_project",
      song_id: song.id,
      mode: "Double",
      name: "Rules",
      timing: {
        duration_ticks: demo.document.project.music.duration_ticks,
        ticks_per_beat: demo.document.project.music.ticks_per_beat,
        offset_micros: demo.document.project.music.offset_micros,
        tempo: demo.document.project.music.tempo,
        reference_accents: demo.document.project.music.reference_accents,
      },
      evaluation_contract: demo.document.project.evaluation_contract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: 32,
        step_ticks: 8,
        pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
      },
    })
    const created = await service.command(create)
    const project = created.project
    if (project === undefined) throw new Error("Expected created project")

    // When
    const stale = service.command(
      ProjectCommandSchema.parse({
        type: "write_project",
        project_id: project.id,
        base_revision: project.revision + 1,
        name: project.name,
        timing: project.timing,
        evaluation_contract: project.evaluation_contract,
        generation_rules: project.generation_rules,
      }),
    )

    // Then
    await expect(stale).rejects.toMatchObject({
      code: "project_revision_conflict",
      currentRevision: 0,
    })
    expect(service.list()).toMatchObject({ revision: 1, selected_project_id: project.id })
    expect(service.read(project.id)).toEqual(project)
    expect(service.songs()).toEqual(store.library().songs)
    expect(service.chart(store.library().active_chart_id).chart.id).toBe(
      store.library().active_chart_id,
    )
  })

  it("drives project create, list, and read through the HTTP API", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-project-routes-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )
    const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
    const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
    const song = studio.store.library().songs[0]
    if (song === undefined) throw new Error("Expected initial song")
    const source = bootstrap.document.project
    const command = ProjectCommandSchema.parse({
      type: "create_project",
      song_id: song.id,
      mode: "Double",
      name: "API rules",
      timing: {
        duration_ticks: source.music.duration_ticks,
        ticks_per_beat: source.music.ticks_per_beat,
        offset_micros: source.music.offset_micros,
        tempo: source.music.tempo,
        reference_accents: source.music.reference_accents,
      },
      evaluation_contract: source.evaluation_contract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: source.music.duration_ticks,
        step_ticks: 8,
        pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
      },
    })

    // When
    const createdResponse = await studio.app.request(
      "http://127.0.0.1:4173/api/v1/projects/actions",
      {
        method: "POST",
        headers: {
          cookie,
          "x-csrf-token": bootstrap.csrf_token,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
      },
    )
    const created = await createdResponse.json()
    const id = created.project?.id
    const listed = await studio.app.request("http://127.0.0.1:4173/api/v1/projects", {
      headers: { cookie },
    })
    const read = await studio.app.request(`http://127.0.0.1:4173/api/v1/projects/${id}`, {
      headers: { cookie },
    })

    // Then
    expect(createdResponse.status).toBe(200)
    expect(await listed.json()).toMatchObject({ selected_project_id: id })
    expect(await read.json()).toMatchObject({ id, name: "API rules" })
  })
})
