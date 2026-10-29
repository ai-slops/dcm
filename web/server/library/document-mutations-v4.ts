import { createHash } from "node:crypto"

import type { z } from "zod"
import { RevisionSchema } from "../../shared/api.ts"
import { BeatChartDocumentSchema, BeatCurrentDocumentSchema } from "../../shared/beat-projects.ts"
import { LibraryRevisionSchema } from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord, StoreMutation } from "../store.ts"
import { beatChartSummary, type PersistedStateV4 } from "./state-v4.ts"

export function saveBeatDocumentMutation(
  state: PersistedStateV4,
  baseRevision: number,
  projectInput: unknown,
): StoreMutation<z.infer<typeof BeatCurrentDocumentSchema>> {
  expectRevision(state, baseRevision)
  const project = parseBeatDocument(projectInput)
  const active = activeChart(state)
  if (project.mode !== active.mode)
    throw new StudioError(409, "chart_mode_immutable", "Create a new chart to use a different mode")
  const song = state.library.songs.find((candidate) => candidate.id === active.song_id)
  if (song === undefined) throw new StudioError(500, "library_corrupt", "Active song is missing")
  if (
    project.audio_sha256 !== song.audio.sha256 ||
    project.audio_asset.format !== song.audio.format ||
    project.audio_asset.byte_length !== song.audio.byte_length
  )
    throw new StudioError(409, "audio_immutable", "Document save cannot replace audio metadata")
  const nextDocument = {
    revision: RevisionSchema.parse(state.document.revision + 1),
    project,
    ...(state.document.origin === undefined ? {} : { origin: state.document.origin }),
  }
  const summaryChanged =
    JSON.stringify(beatChartSummary(project)) !== JSON.stringify(beatChartSummary(active.project))
  const next = {
    ...state,
    document: nextDocument,
    library: {
      ...state.library,
      revision: LibraryRevisionSchema.parse(state.library.revision + (summaryChanged ? 1 : 0)),
      charts: state.library.charts.map((chart) =>
        chart.id === active.id ? { ...chart, ...beatChartSummary(project), project } : chart,
      ),
    },
  }
  return { state: next, result: BeatCurrentDocumentSchema.parse(nextDocument) }
}

export function replaceBeatDocumentMutation(
  state: PersistedStateV4,
  baseRevision: number,
  projectInput: unknown,
  bytes: Uint8Array,
): StoreMutation<z.infer<typeof BeatCurrentDocumentSchema>> {
  expectRevision(state, baseRevision)
  const project = parseBeatDocument(projectInput)
  const audio = audioRecord(bytes, project.audio_asset.format)
  if (audio.bytes.byteLength !== project.audio_asset.byte_length)
    throw new StudioError(400, "audio_length", "Audio byte length differs from project metadata")
  if (audio.digest !== project.audio_sha256)
    throw new StudioError(400, "audio_sha256", "Audio SHA-256 differs from project metadata")
  const active = activeChart(state)
  const binding = { ...project.audio_asset, sha256: audio.digest }
  const charts = state.library.charts.map((chart) => {
    if (chart.song_id !== active.song_id) return chart
    if (chart.id === active.id) {
      const { generated_from: _generatedFrom, ...replaced } = chart
      return { ...replaced, ...beatChartSummary(project), project }
    }
    const rebound = {
      ...chart.project,
      audio_sha256: project.audio_sha256,
      audio_asset: project.audio_asset,
    }
    return {
      ...chart,
      project: rebound,
    }
  })
  const document = { revision: RevisionSchema.parse(state.document.revision + 1), project }
  const next = {
    ...state,
    document,
    library: {
      ...state.library,
      revision: LibraryRevisionSchema.parse(state.library.revision + 1),
      songs: state.library.songs.map((song) =>
        song.id === active.song_id ? { ...song, audio: binding } : song,
      ),
      charts,
    },
  }
  return {
    state: next,
    result: BeatCurrentDocumentSchema.parse(document),
    assets: [
      { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes },
    ],
  }
}

function activeChart(state: PersistedStateV4) {
  const chart = state.library.charts.find(
    (candidate) => candidate.id === state.library.active_chart_id,
  )
  if (chart === undefined) throw new StudioError(500, "library_corrupt", "Active chart is missing")
  return chart
}

function expectRevision(state: PersistedStateV4, revision: number): void {
  if (revision !== state.document.revision)
    throw new StudioError(
      409,
      "revision_conflict",
      "Document revision is stale",
      state.document.revision,
    )
}

function audioRecord(bytes: Uint8Array, format: AudioRecord["format"]): AudioRecord {
  return {
    bytes: Uint8Array.from(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
    format,
  }
}

function parseBeatDocument(input: unknown) {
  const result = BeatChartDocumentSchema.safeParse(input)
  if (result.success) return result.data
  if (result.error.issues.some((issue) => issue.message === "notes collide or are not canonical"))
    throw new StudioError(400, "ucs_cell_conflict", "Notes cannot share panel cells or hold tails")
  throw result.error
}
