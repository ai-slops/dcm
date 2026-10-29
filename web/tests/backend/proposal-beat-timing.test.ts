import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { nativeDocumentFor } from "../../server/native/beat-document.ts"
import { BootstrapSchema, ChartProposalSchema, CurrentDocumentSchema } from "../../shared/index.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("applies proposal music timing through the native-to-beat boundary", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-proposal-beat-timing-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const session = studio.sessions.get(bootstrap.session_id)
  if (session === undefined) throw new Error("Expected bootstrap session")
  const native = nativeDocumentFor(bootstrap.document.project)
  const proposal = ChartProposalSchema.parse({
    id: studio.sessions.proposalId(),
    base_revision: bootstrap.document.revision,
    source: "agent",
    summary: "Adjust timing",
    chart: native.chart,
    music: { ...native.music, offset_micros: native.music.offset_micros + 12_345 },
    before: { chart: native.chart, music: native.music },
  })
  session.proposals.set(proposal.id, proposal)

  // When
  const response = await studio.app.request(
    `http://127.0.0.1:4173/api/v1/proposals/${proposal.id}/apply`,
    {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": bootstrap.csrf_token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ base_revision: bootstrap.document.revision }),
    },
  )

  // Then
  expect(response.status).toBe(200)
  const saved = CurrentDocumentSchema.parse(await response.json())
  expect(saved.project.timing.offset_micros).toBe(native.music.offset_micros + 12_345)
})

it.each([false, true])(
  "preserves automatic duration and omitted tail timing when applying a concrete native proposal: %s",
  async (futureTiming) => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "pump-proposal-auto-duration-"))
    roots.push(root)
    const studio = await createStudioApp(
      loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
    )
    const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
    const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
    const automatic = await studio.store.save(bootstrap.document.revision, {
      ...bootstrap.document.project,
      timing: {
        ...bootstrap.document.project.timing,
        duration: null,
        tempo: [
          ...bootstrap.document.project.timing.tempo,
          ...(futureTiming
            ? [
                {
                  at: { numerator: 16, denominator: 1 },
                  micros_per_beat: { numerator: 300_000, denominator: 1 },
                },
              ]
            : []),
        ],
        grid_sections: [
          ...bootstrap.document.project.timing.grid_sections,
          ...(futureTiming
            ? [{ at: { numerator: 16, denominator: 1 }, rows_per_measure: 12 }]
            : []),
        ],
        reference_accents: [
          ...bootstrap.document.project.timing.reference_accents,
          ...(futureTiming ? [{ numerator: 16, denominator: 1 }] : []),
        ],
      },
    })
    const session = studio.sessions.get(bootstrap.session_id)
    if (session === undefined) throw new TypeError("Expected bootstrap session")
    const native = nativeDocumentFor(automatic.project)
    const proposal = ChartProposalSchema.parse({
      id: studio.sessions.proposalId(),
      base_revision: automatic.revision,
      source: "agent",
      summary: "Adjust automatic timing",
      chart: native.chart,
      music: { ...native.music, offset_micros: native.music.offset_micros + 9_000 },
      before: { chart: native.chart, music: native.music },
    })
    session.proposals.set(proposal.id, proposal)

    // When
    const response = await studio.app.request(
      `http://127.0.0.1:4173/api/v1/proposals/${proposal.id}/apply`,
      {
        method: "POST",
        headers: {
          cookie,
          "x-csrf-token": bootstrap.csrf_token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ base_revision: automatic.revision }),
      },
    )

    // Then
    expect(response.status).toBe(200)
    const saved = CurrentDocumentSchema.parse(await response.json())
    expect(saved.project.timing.offset_micros).toBe(native.music.offset_micros + 9_000)
    expect(saved.project.timing.duration).toBeNull()
    expect(saved.project.timing.tempo).toEqual(automatic.project.timing.tempo)
    expect(saved.project.timing.grid_sections).toEqual(automatic.project.timing.grid_sections)
    expect(saved.project.timing.reference_accents).toEqual(
      automatic.project.timing.reference_accents,
    )
  },
)
