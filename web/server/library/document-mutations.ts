import { createHash } from "node:crypto"

import {
  ChartDocumentSchema,
  type CurrentDocument,
  normalizeChartDocument,
  RevisionSchema,
  type StudioProjectV1,
} from "../../shared/index.ts"
import { LibraryRevisionSchema } from "../../shared/library.ts"
import { assertEditableChart } from "../chart-boundary.ts"
import { StudioError } from "../errors.ts"
import type { AudioRecord, StoreMutation } from "../store.ts"
import { chartSummary, hexDigest } from "./chart-summary.ts"
import { currentDocument } from "./document-view.ts"
import type { PersistedStateV3 } from "./state.ts"

export function saveDocumentMutation(
  state: PersistedStateV3,
  baseRevision: number,
  projectInput: unknown,
): StoreMutation<CurrentDocument> {
  expectRevision(state, baseRevision)
  const project = ChartDocumentSchema.parse(projectInput)
  assertEditableChart(project.chart)
  const active = activeChart(state)
  if (project.ucs_mode !== active.mode)
    throw new StudioError(409, "chart_mode_immutable", "Create a new chart to use a different mode")
  const song = state.library.songs.find((candidate) => candidate.id === active.song_id)
  if (song === undefined) throw new StudioError(500, "library_corrupt", "Active song is missing")
  if (
    hexDigest(project.music.audio_sha256) !== song.audio.sha256 ||
    project.audio_asset.format !== song.audio.format ||
    project.audio_asset.byte_length !== song.audio.byte_length
  )
    throw new StudioError(409, "audio_immutable", "Document save cannot replace audio metadata")
  const nextDocument = { revision: RevisionSchema.parse(state.document.revision + 1), project }
  const summaryChanged =
    JSON.stringify(chartSummary(project)) !== JSON.stringify(chartSummary(active.project))
  const next = {
    ...state,
    document: nextDocument,
    library: {
      ...state.library,
      revision: LibraryRevisionSchema.parse(state.library.revision + (summaryChanged ? 1 : 0)),
      charts: state.library.charts.map((chart) =>
        chart.id === active.id
          ? {
              ...chart,
              ...chartSummary(project),
              mode: project.ucs_mode,
              project,
            }
          : chart,
      ),
    },
  }
  return { state: next, result: currentDocument(next) }
}

export function replaceDocumentMutation(
  state: PersistedStateV3,
  baseRevision: number,
  projectInput: unknown,
  bytes: Uint8Array,
): StoreMutation<CurrentDocument> {
  expectRevision(state, baseRevision)
  const project = normalizeChartDocument(projectInput)
  assertEditableChart(project.chart)
  const audio = audioRecord(bytes, project.audio_asset.format)
  assertReplacementAudio(project, audio)
  const active = activeChart(state)
  const binding = { ...project.audio_asset, sha256: audio.digest }
  const charts = state.library.charts.map((chart) => {
    if (chart.song_id !== active.song_id) return chart
    const rebound =
      chart.id === active.id
        ? project
        : {
            ...chart.project,
            music: { ...chart.project.music, audio_sha256: [...project.music.audio_sha256] },
            audio_asset: project.audio_asset,
          }
    return {
      ...chart,
      ...(chart.id === active.id ? chartSummary(project) : {}),
      mode: chart.id === active.id ? project.ucs_mode : chart.mode,
      project: rebound,
    }
  })
  const next = {
    ...state,
    document: { revision: RevisionSchema.parse(state.document.revision + 1), project },
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
    result: currentDocument(next),
    assets: [
      { directory: "audio", digest: audio.digest, extension: audio.format, bytes: audio.bytes },
    ],
  }
}

function activeChart(state: PersistedStateV3) {
  const chart = state.library.charts.find(
    (candidate) => candidate.id === state.library.active_chart_id,
  )
  if (chart === undefined) throw new StudioError(500, "library_corrupt", "Active chart is missing")
  return chart
}

function expectRevision(state: PersistedStateV3, revision: number): void {
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

function assertReplacementAudio(project: StudioProjectV1, audio: AudioRecord): void {
  if (audio.bytes.byteLength !== project.audio_asset.byte_length)
    throw new StudioError(400, "audio_length", "Audio byte length differs from project metadata")
  if (audio.digest !== hexDigest(project.music.audio_sha256))
    throw new StudioError(400, "audio_sha256", "Audio SHA-256 differs from music metadata")
}
