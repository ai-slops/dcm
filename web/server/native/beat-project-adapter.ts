import { addBeats, type Beat, compareBeats } from "../../shared/beat.ts"
import {
  type NativeCapability,
  nativeEvaluationExtentCapability,
  nativeTicksPerBeatFor,
} from "../../shared/beat-native-capability.ts"
import { timingAtOutputExtent } from "../../shared/beat-output.ts"
import type { GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { GenerationProject } from "../../shared/generation-projects.ts"
import {
  beatToTicks,
  evaluationBeats,
  projectEvaluation,
  projectRules,
  ruleBeats,
} from "./beat-project-conversion.ts"

export type BeatProjectNativeCapability = NativeCapability

export type BeatProjectNativeProjection =
  | { readonly kind: "supported"; readonly project: GenerationProject }
  | {
      readonly kind: "unsupported"
      readonly capability: BeatProjectNativeCapability
    }

export function projectBeatGenerationNative(
  project: GenerationProjectV2,
): BeatProjectNativeProjection {
  const duration = project.timing.duration ?? automaticProjectDuration(project)
  if (duration === null)
    return { kind: "unsupported", capability: { code: "native_duration_unresolved" } }
  const outputTiming = timingAtOutputExtent(project.timing, duration)
  const evaluationCapability = nativeEvaluationExtentCapability(
    project.evaluation_contract,
    duration,
  )
  if (evaluationCapability !== null)
    return { kind: "unsupported", capability: evaluationCapability }
  const nativeGrid = nativeTicksPerBeatFor(
    projectBeats(project, outputTiming),
    outputTiming.grid_sections.map((section) => section.rows_per_measure),
  )
  if (nativeGrid.kind === "unsupported") return nativeGrid
  const ticksPerBeat = nativeGrid.ticks_per_beat
  const durationTicks = beatToTicks(duration, ticksPerBeat)
  if (durationTicks > 1_000_000)
    return {
      kind: "unsupported",
      capability: {
        code: "native_limit_unsupported",
        field: "duration_ticks",
        value: durationTicks,
        limit: 1_000_000,
      },
    }
  const nativeTicksPerBeat = Number(ticksPerBeat)
  return {
    kind: "supported",
    project: {
      schema_version: 1,
      id: project.id,
      revision: project.revision,
      name: project.name,
      song_id: project.song_id,
      mode: project.mode,
      applied_components: {
        ...(project.applied_components.timing === undefined
          ? {}
          : { timing: project.applied_components.timing }),
        ...(project.applied_components.evaluation === undefined
          ? {}
          : { evaluation: project.applied_components.evaluation }),
        ...(project.applied_components.generator === undefined
          ? {}
          : { generator: project.applied_components.generator }),
      },
      timing: {
        duration_ticks: durationTicks,
        ticks_per_beat: nativeTicksPerBeat,
        offset_micros: outputTiming.offset_micros,
        tempo: outputTiming.tempo.map((segment) => ({
          start_tick: beatToTicks(segment.at, ticksPerBeat),
          micros_per_beat: segment.micros_per_beat,
        })),
        reference_accents: outputTiming.reference_accents.map((beat) =>
          beatToTicks(beat, ticksPerBeat),
        ),
      },
      evaluation_contract: projectEvaluation(project.evaluation_contract, ticksPerBeat),
      generation_rules: projectRules(project.generation_rules, ticksPerBeat),
    },
  }
}

function projectBeats(
  project: GenerationProjectV2,
  timing: ReturnType<typeof timingAtOutputExtent>,
): readonly Beat[] {
  return [
    ...(timing.duration === null ? [] : [timing.duration]),
    ...timing.tempo.map((segment) => segment.at),
    ...timing.grid_sections.map((section) => section.at),
    ...timing.reference_accents,
    ...ruleBeats(project.generation_rules),
    ...evaluationBeats(project.evaluation_contract),
  ]
}

function automaticProjectDuration(project: GenerationProjectV2): Beat | null {
  if (project.generation_rules.schema_version === 1) return project.generation_rules.end
  let extent: Beat | null = null
  for (const region of project.generation_rules.regions)
    if (extent === null || compareBeats(region.rules.end, extent) > 0) extent = region.rules.end
  for (const note of project.generation_rules.fixed_notes) {
    const end = addBeats(note.at, note.hold)
    const grid = [...project.timing.grid_sections]
      .reverse()
      .find((section) => compareBeats(section.at, end) <= 0)
    if (grid === undefined) continue
    const padded = addBeats(end, { numerator: 4, denominator: grid.rows_per_measure })
    if (extent === null || compareBeats(padded, extent) > 0) extent = padded
  }
  return extent
}
