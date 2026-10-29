import { beatFromTicks } from "../../shared/beat.ts"
import type { BeatEvaluationContract } from "../../shared/beat-evaluation.ts"
import { BeatChartDocumentSchema, GenerationProjectV2Schema } from "../../shared/beat-projects.ts"
import type { BeatGenerationRules } from "../../shared/beat-rules.ts"
import type { EvalContract } from "../../shared/evaluation-contract.ts"
import type { GenerationProject, ReusableComponent } from "../../shared/generation-projects.ts"
import type { GenerationRules } from "../../shared/generation-rules.ts"
import { canonicalizeChart } from "../../shared/native.ts"
import type { StudioProjectV1 } from "../../shared/project.ts"

export function migrateLegacyChart(project: StudioProjectV1) {
  const ticksPerBeat = project.music.ticks_per_beat
  const rowsPerMeasure = ticksPerBeat * 4
  return BeatChartDocumentSchema.parse({
    schema_version: 1,
    title: project.title,
    artist: project.artist,
    chart_artist: null,
    mode: project.ucs_mode ?? "Double",
    timing: migrateTiming(project.music, rowsPerMeasure),
    notes: canonicalizeChart(project.chart).notes.map((note) => ({
      at: beatFromTicks(note.tick, ticksPerBeat),
      hold: beatFromTicks(note.hold_ticks, ticksPerBeat),
      panel_mask: note.panel_mask,
    })),
    audio_sha256: Buffer.from(project.music.audio_sha256).toString("hex"),
    audio_asset: project.audio_asset,
    evaluation_contract: migrateEvaluation(project.evaluation_contract, ticksPerBeat),
  })
}

export function migrateLegacyProject(project: GenerationProject) {
  const rowsPerMeasure = project.timing.ticks_per_beat * 4
  return GenerationProjectV2Schema.parse({
    schema_version: 2,
    id: project.id,
    revision: project.revision,
    name: project.name,
    song_id: project.song_id,
    mode: project.mode,
    chart_artist: null,
    base_ucs_ref: null,
    timing: migrateTiming(project.timing, rowsPerMeasure),
    evaluation_contract: migrateEvaluation(
      project.evaluation_contract,
      project.timing.ticks_per_beat,
    ),
    generation_rules: migrateRules(project.generation_rules, project.timing.ticks_per_beat),
    applied_components: project.applied_components,
  })
}

export function migrateLegacyComponent(
  component: ReusableComponent,
  source: GenerationProject | undefined,
) {
  const summary = {
    id: component.id,
    revision: component.revision,
    name: component.name,
    source_project_id: component.source_project_id,
    source_project_revision: component.source_project_revision,
  }
  if (component.kind === "timing") {
    const rowsPerMeasure = component.value.ticks_per_beat * 4
    return {
      ...summary,
      kind: "timing" as const,
      value: migrateTiming(component.value, rowsPerMeasure),
    }
  }
  if (source === undefined)
    return {
      ...summary,
      kind: "legacy_unresolved" as const,
      original_kind: component.kind,
      legacy_value: component.value,
      read_only_reason: "legacy_component_basis_missing" as const,
    }
  const ticksPerBeat = source.timing.ticks_per_beat
  return component.kind === "evaluation"
    ? {
        ...summary,
        kind: "evaluation" as const,
        value: migrateEvaluation(component.value, ticksPerBeat),
      }
    : { ...summary, kind: "generator" as const, value: migrateRules(component.value, ticksPerBeat) }
}

export function migrateTiming(
  timing: {
    readonly duration_ticks: number
    readonly ticks_per_beat: number
    readonly offset_micros: number
    readonly tempo: readonly {
      readonly start_tick: number
      readonly micros_per_beat: { readonly numerator: number; readonly denominator: number }
    }[]
    readonly reference_accents: readonly number[]
  },
  rowsPerMeasure: number,
) {
  return {
    schema_version: 1 as const,
    offset_micros: timing.offset_micros,
    tempo: timing.tempo.map((segment) => ({
      at: beatFromTicks(segment.start_tick, timing.ticks_per_beat),
      micros_per_beat: segment.micros_per_beat,
    })),
    grid_sections: [
      { at: beatFromTicks(0, timing.ticks_per_beat), rows_per_measure: rowsPerMeasure },
    ],
    duration: beatFromTicks(timing.duration_ticks, timing.ticks_per_beat),
    reference_accents: timing.reference_accents.map((tick) =>
      beatFromTicks(tick, timing.ticks_per_beat),
    ),
  }
}

export function migrateEvaluation(
  contract: EvalContract,
  ticksPerBeat: number,
): BeatEvaluationContract {
  return {
    ...contract,
    difficulty: {
      ...contract.difficulty,
      local_windows: contract.difficulty.local_windows.map((window) => ({
        width: beatFromTicks(window.width_ticks, ticksPerBeat),
        maximum_load: window.maximum_load,
      })),
    },
    intents: contract.intents.map((intent) => ({
      ...intent,
      kind:
        intent.kind.kind === "reference_accents"
          ? {
              kind: intent.kind.kind,
              tolerance: beatFromTicks(intent.kind.tolerance_ticks, ticksPerBeat),
            }
          : intent.kind.kind === "negative_space"
            ? {
                kind: intent.kind.kind,
                start: beatFromTicks(intent.kind.start_tick, ticksPerBeat),
                end: beatFromTicks(intent.kind.end_tick, ticksPerBeat),
              }
            : intent.kind,
    })),
  }
}

export function migrateRules(rules: GenerationRules, ticksPerBeat: number): BeatGenerationRules {
  const migrateCycle = (cycle: {
    readonly start_tick: number
    readonly end_tick: number
    readonly step_ticks: number
    readonly pattern: readonly {
      readonly choices: readonly {
        readonly panel_mask: number
        readonly hold_ticks: number
        readonly weight: number
      }[]
    }[]
  }) => ({
    start: beatFromTicks(cycle.start_tick, ticksPerBeat),
    end: beatFromTicks(cycle.end_tick, ticksPerBeat),
    step: beatFromTicks(cycle.step_ticks, ticksPerBeat),
    pattern: cycle.pattern.map((frame) => ({
      choices: frame.choices.map((choice) => ({
        panel_mask: choice.panel_mask,
        hold: beatFromTicks(choice.hold_ticks, ticksPerBeat),
        weight: choice.weight,
      })),
    })),
  })
  return rules.schema_version === 1
    ? { schema_version: 1, algorithm: rules.algorithm, ...migrateCycle(rules) }
    : {
        schema_version: 2,
        algorithm: rules.algorithm,
        fixed_notes: canonicalizeChart({
          ticks_per_beat: ticksPerBeat,
          span_ticks: 1_000_000,
          notes: rules.fixed_notes,
        }).notes.map((note) => ({
          at: beatFromTicks(note.tick, ticksPerBeat),
          hold: beatFromTicks(note.hold_ticks, ticksPerBeat),
          panel_mask: note.panel_mask,
        })),
        regions: rules.regions.map((region) => ({ ...region, rules: migrateCycle(region.rules) })),
      }
}
