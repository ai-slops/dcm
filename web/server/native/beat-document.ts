import {
  type NativeCapability,
  nativeEvaluationExtentCapability,
  nativeTicksPerBeatFor,
} from "../../shared/beat-native-capability.ts"
import { resolveChartOutputTiming } from "../../shared/beat-output.ts"
import type { BeatChartDocument } from "../../shared/beat-projects.ts"
import { canonicalizeChart } from "../../shared/native.ts"
import { type StudioProjectV1, StudioProjectV1Schema } from "../../shared/project.ts"
import { nativeMetadata } from "../library/project-factory.ts"
import { beatToTicks, evaluationBeats, projectEvaluation } from "./beat-project-conversion.ts"

export class NativeDocumentUnsupportedError extends Error {
  readonly capability: NativeCapability
  readonly code: NativeCapability["code"]

  constructor(capability: NativeCapability) {
    super(capabilityMessage(capability))
    this.name = "NativeDocumentUnsupportedError"
    this.capability = capability
    this.code = capability.code
  }
}

export function nativeDocumentFor(document: BeatChartDocument): StudioProjectV1 {
  const outputTiming = resolveChartOutputTiming({
    mode: document.mode,
    timing: document.timing,
    notes: document.notes,
  })
  if (outputTiming === null || outputTiming.duration === null)
    throw new NativeDocumentUnsupportedError({ code: "native_duration_unresolved" })
  const duration = outputTiming.duration
  const evaluationCapability = nativeEvaluationExtentCapability(
    document.evaluation_contract,
    duration,
  )
  if (evaluationCapability !== null) throw new NativeDocumentUnsupportedError(evaluationCapability)
  const beats = [
    duration,
    ...document.notes.flatMap((note) => [note.at, note.hold]),
    ...outputTiming.tempo.map((segment) => segment.at),
    ...outputTiming.grid_sections.map((section) => section.at),
    ...outputTiming.reference_accents,
    ...evaluationBeats(document.evaluation_contract),
  ]
  const nativeGrid = nativeTicksPerBeatFor(
    beats,
    outputTiming.grid_sections.map((section) => section.rows_per_measure),
  )
  if (nativeGrid.kind === "unsupported")
    throw new NativeDocumentUnsupportedError(nativeGrid.capability)
  const ticksPerBeat = nativeGrid.ticks_per_beat
  const durationTicks = beatToTicks(duration, ticksPerBeat)
  if (durationTicks > 1_000_000)
    throw new NativeDocumentUnsupportedError({
      code: "native_limit_unsupported",
      field: "duration_ticks",
      value: durationTicks,
      limit: 1_000_000,
    })
  const nativeTicksPerBeat = Number(ticksPerBeat)
  return StudioProjectV1Schema.parse({
    schema_version: 1,
    title: nativeMetadata(document.title),
    artist: nativeMetadata(document.artist),
    chart: canonicalizeChart({
      ticks_per_beat: nativeTicksPerBeat,
      span_ticks: durationTicks,
      notes: document.notes.map((note) => ({
        tick: beatToTicks(note.at, ticksPerBeat),
        panel_mask: note.panel_mask,
        hold_ticks: beatToTicks(note.hold, ticksPerBeat),
      })),
    }),
    music: {
      duration_ticks: durationTicks,
      ticks_per_beat: nativeTicksPerBeat,
      offset_micros: outputTiming.offset_micros,
      tempo: outputTiming.tempo.map((segment) => ({
        start_tick: beatToTicks(segment.at, ticksPerBeat),
        micros_per_beat: segment.micros_per_beat,
      })),
      audio_sha256: digestBytes(document.audio_sha256),
      reference_accents: outputTiming.reference_accents.map((beat) =>
        beatToTicks(beat, ticksPerBeat),
      ),
    },
    evaluation_contract: projectEvaluation(document.evaluation_contract, ticksPerBeat),
    audio_asset: document.audio_asset,
    ucs_mode: document.mode,
  })
}

function digestBytes(digest: string): readonly number[] {
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16),
  )
}

function capabilityMessage(capability: NativeCapability): string {
  switch (capability.code) {
    case "native_duration_unresolved":
      return "Native projection requires a concrete output extent"
    case "native_grid_unsupported":
      return `Exact native projection requires at least ${capability.required_tpb} ticks per beat; limit ${capability.limit}`
    case "native_limit_unsupported":
      return `Exact native ${capability.field} ${capability.value} exceeds limit ${capability.limit}`
    case "native_evaluation_extent_unsupported":
      return capability.message
  }
}
