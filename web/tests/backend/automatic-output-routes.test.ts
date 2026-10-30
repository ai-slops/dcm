import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { buildAgentProposal } from "../../server/agent/proposal.ts"
import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { compatibleEvaluationContract } from "../../server/library/project-factory.ts"
import { beatChartSummary } from "../../server/library/state-v4.ts"
import { nativeDocumentFor } from "../../server/native/beat-document.ts"
import { NativeBeatUcsService } from "../../server/native/beat-ucs.ts"
import type { Services } from "../../server/types.ts"
import {
  BeatChartDocumentSchema,
  BeatDocumentOriginSchema,
  BootstrapSchema,
  beatOutputContextFor,
  type StudioProjectV1,
} from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("trusted automatic output routes", () => {
  it("uses the exclusive region end for root UCS, evaluation, and native export", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-automatic-output-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )
    await installAutomaticDocument(studio)
    const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
    const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
    const expectedNative = nativeDocumentFor(
      bootstrap.document.project,
      beatOutputContextFor(bootstrap.document),
    )
    const headers = {
      cookie: bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
      "content-type": "application/json",
      "x-csrf-token": bootstrap.csrf_token,
    }
    let evaluated: StudioProjectV1 | undefined
    let exported: StudioProjectV1 | undefined
    const evaluate = studio.native.evaluate.bind(studio.native)
    vi.spyOn(studio.native, "evaluate").mockImplementation((project, signal) => {
      evaluated = project
      return evaluate(project, signal)
    })
    vi.spyOn(studio.native, "export").mockImplementation(async (project) => {
      exported = project
      return new Uint8Array([1])
    })

    // When
    const evaluation = await studio.app.request("http://127.0.0.1:4173/api/v1/evaluations", {
      method: "POST",
      headers,
      body: JSON.stringify({ base_revision: bootstrap.document.revision }),
    })
    const nativeExport = await studio.app.request("http://127.0.0.1:4173/api/v1/exports", {
      method: "POST",
      headers,
      body: JSON.stringify({ base_revision: bootstrap.document.revision }),
    })
    const ucsExport = await studio.app.request("http://127.0.0.1:4173/api/v1/ucs/export", {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_revision: bootstrap.document.revision,
        mode: bootstrap.document.project.mode,
      }),
    })

    // Then
    expect(evaluation.status).toBe(200)
    expect(nativeExport.status).toBe(200)
    expect(ucsExport.status).toBe(200)
    expect(nativeDuration(evaluated)).toBe(4)
    expect(nativeDuration(exported)).toBe(4)
    const roundTripped = await new NativeBeatUcsService(repoRoot).import(
      new TextEncoder().encode(await ucsExport.text()),
      studio.store.audio(),
    )
    expect(roundTripped.timing.duration).toEqual({ numerator: 4, denominator: 1 })
    const proposal = buildAgentProposal(
      bootstrap.document,
      { chart: expectedNative.chart, summary: "Preserve trusted output extent" },
      crypto.randomUUID(),
    )
    expect(
      proposal.before === undefined
        ? undefined
        : proposal.before.music.duration_ticks / expectedNative.music.ticks_per_beat,
    ).toBe(4)
    expect(studio.store.document().project.timing.duration).toBeNull()
    expect(studio.store.document().origin).toEqual(bootstrap.document.origin)
  }, 60_000)
})

async function installAutomaticDocument(studio: Services): Promise<void> {
  const duration = { numerator: 4, denominator: 1 } as const
  await studio.store.transact(undefined, (state) => {
    const source = state.document.project
    const project = BeatChartDocumentSchema.parse({
      ...source,
      timing: { ...source.timing, duration: null },
      notes: [
        {
          at: { numerator: 3, denominator: 1 },
          hold: { numerator: 0, denominator: 1 },
          panel_mask: 1,
        },
      ],
      evaluation_contract: compatibleEvaluationContract(source, duration),
    })
    const origin = BeatDocumentOriginSchema.parse({
      project_id: "00000000-0000-4000-8000-000000000001",
      project_revision: 0,
      seed: "0".repeat(64),
      automatic_regions: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Trusted region",
          start: { numerator: 0, denominator: 1 },
          end: duration,
        },
      ],
    })
    const charts = state.library.charts.map((chart) =>
      chart.id === state.library.active_chart_id
        ? { ...chart, ...beatChartSummary(project), generated_from: origin, project }
        : chart,
    )
    return {
      state: {
        ...state,
        document: { ...state.document, project, origin },
        library: { ...state.library, charts },
      },
      result: undefined,
    }
  })
}

function nativeDuration(project: StudioProjectV1 | undefined): number | undefined {
  return project === undefined
    ? undefined
    : project.music.duration_ticks / project.music.ticks_per_beat
}
