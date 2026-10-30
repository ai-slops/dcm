import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unzipSync } from "fflate"
import { expect, it, vi } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { LibraryArchives } from "../../server/library/archives.ts"
import { LibraryService } from "../../server/library/service.ts"
import { beatChartSummary } from "../../server/library/state-v4.ts"
import { NativeBeatUcsService } from "../../server/native/beat-ucs.ts"
import { StudioStore } from "../../server/store.ts"
import { BeatChartDocumentSchema, BeatDocumentOriginSchema } from "../../shared/index.ts"
import { ChartIdSchema } from "../../shared/library.ts"
import { repoRoot } from "../support/paths.ts"

it("exports one chart/audio snapshot when the song changes during native conversion", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-export-snapshot-"))
  try {
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const song = store.library().songs[0]
    expect(song).toBeDefined()
    if (song === undefined) throw new Error("Expected initial song")
    const original = store.document().project
    const ucs = new NativeBeatUcsService(repoRoot)
    const convert = ucs.export.bind(ucs)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    vi.spyOn(ucs, "export").mockImplementation(async (project, signal) => {
      entered.resolve()
      await resume.promise
      return convert(project, signal)
    })
    const exported = new LibraryArchives(store, ucs).exportSong(song.id)
    await entered.promise
    const changedAudio = Uint8Array.from(demo.audio)
    changedAudio[changedAudio.length - 1] = (changedAudio.at(-1) ?? 0) ^ 1

    // When
    try {
      await store.save(store.document().revision, {
        ...store.document().project,
        notes: [],
      })
      await new LibraryService(store).rebindAudio(
        song.id,
        store.library().revision,
        store.document().revision,
        {
          bytes: changedAudio,
          format: "wav",
          digest: createHash("sha256").update(changedAudio).digest("hex"),
        },
      )
    } finally {
      resume.resolve()
    }
    const files = unzipSync(await exported)

    // Then
    expect(files["music.wav"]).toEqual(Uint8Array.from(demo.audio))
    expect(files["Main.ucs"]).toEqual(
      Uint8Array.from(
        await convert({
          timing: original.timing,
          notes: original.notes,
          mode: original.mode,
        }),
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("passes saved generated provenance to inactive chart UCS exports", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "pump-export-origin-"))
  try {
    const demo = await loadDemo(repoRoot)
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const song = store.library().songs[0]
    if (song === undefined) throw new Error("Expected initial song")
    const duration = { numerator: 4, denominator: 1 } as const
    const origin = BeatDocumentOriginSchema.parse({
      project_id: "00000000-0000-4000-8000-000000000001",
      project_revision: 0,
      seed: "0".repeat(64),
      automatic_regions: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Inactive generated region",
          start: { numerator: 0, denominator: 1 },
          end: duration,
        },
      ],
    })
    await store.transact(undefined, (state) => {
      const active = state.library.charts.find(
        (chart) => chart.id === state.library.active_chart_id,
      )
      if (active === undefined) throw new Error("Expected active chart")
      const project = BeatChartDocumentSchema.parse({
        ...active.project,
        timing: { ...active.project.timing, duration: null },
        notes: [],
      })
      const generated = {
        ...active,
        id: ChartIdSchema.parse("00000000-0000-4000-8000-000000000003"),
        name: "Inactive generated",
        ...beatChartSummary(project),
        generated_from: origin,
        project,
      }
      return {
        state: {
          ...state,
          library: { ...state.library, charts: [...state.library.charts, generated] },
        },
        result: undefined,
      }
    })
    const contexts: unknown[] = []
    const ucs = new NativeBeatUcsService(repoRoot)
    vi.spyOn(ucs, "export").mockImplementation(async (_project, _signal, context) => {
      contexts.push(context)
      return new Uint8Array()
    })

    // When
    await new LibraryArchives(store, ucs).exportSong(song.id)

    // Then
    expect(contexts).toContainEqual({ automatic_region_ends: [duration] })
    const inactive = store.chartDocument(
      ChartIdSchema.parse("00000000-0000-4000-8000-000000000003"),
    )
    expect(inactive.project.timing.duration).toBeNull()
    expect(inactive.chart.generated_from).toEqual(origin)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
