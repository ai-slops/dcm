import type { Beat } from "../../shared/beat.ts"
import type { BeatEvaluationContract } from "../../shared/beat-evaluation.ts"
import type { BeatCycleRules, BeatGenerationRules } from "../../shared/beat-rules.ts"
import type { GenerationProject } from "../../shared/generation-projects.ts"

export function ruleBeats(rules: BeatGenerationRules): readonly Beat[] {
  if (rules.schema_version === 1)
    return [
      rules.start,
      rules.end,
      rules.step,
      ...rules.pattern.flatMap((step) => step.choices.map((choice) => choice.hold)),
    ]
  return [
    ...rules.fixed_notes.flatMap((note) => [note.at, note.hold]),
    ...rules.regions.flatMap((region) => [
      region.rules.start,
      region.rules.end,
      region.rules.step,
      ...region.rules.pattern.flatMap((step) => step.choices.map((choice) => choice.hold)),
    ]),
  ]
}

export function evaluationBeats(contract: BeatEvaluationContract): readonly Beat[] {
  return [
    ...contract.difficulty.local_windows.map((window) => window.width),
    ...contract.intents.flatMap((intent) => evaluationIntentBeats(intent.kind)),
  ]
}

export function projectRules(
  rules: BeatGenerationRules,
  ticksPerBeat: bigint,
): GenerationProject["generation_rules"] {
  if (rules.schema_version === 1)
    return {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      ...projectCycle(rules, ticksPerBeat),
    }
  return {
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: rules.fixed_notes.map((note) => ({
      tick: beatToTicks(note.at, ticksPerBeat),
      panel_mask: note.panel_mask,
      hold_ticks: beatToTicks(note.hold, ticksPerBeat),
    })),
    regions: rules.regions.map((region) => ({
      id: region.id,
      name: region.name,
      rules: projectCycle(region.rules, ticksPerBeat),
    })),
  }
}

export function projectEvaluation(
  contract: BeatEvaluationContract,
  ticksPerBeat: bigint,
): GenerationProject["evaluation_contract"] {
  return {
    ...contract,
    difficulty: {
      ...contract.difficulty,
      local_windows: contract.difficulty.local_windows.map((window) => ({
        width_ticks: beatToTicks(window.width, ticksPerBeat),
        maximum_load: window.maximum_load,
      })),
    },
    intents: contract.intents.map((intent) => ({
      ...intent,
      kind: projectIntent(intent.kind, ticksPerBeat),
    })),
  }
}

export function beatToTicks(beat: Beat, ticksPerBeat: bigint): number {
  const scaled = BigInt(beat.numerator) * ticksPerBeat
  const denominator = BigInt(beat.denominator)
  if (scaled % denominator !== 0n)
    throw new RangeError("Beat does not admit an exact native tick coordinate")
  return Number(scaled / denominator)
}

function evaluationIntentBeats(
  kind: BeatEvaluationContract["intents"][number]["kind"],
): readonly Beat[] {
  switch (kind.kind) {
    case "reference_accents":
      return [kind.tolerance]
    case "negative_space":
      return [kind.start, kind.end]
    case "relational_motif":
      return []
  }
}

function projectCycle(
  rules: Extract<BeatGenerationRules, { readonly schema_version: 1 }> | BeatCycleRules,
  ticksPerBeat: bigint,
) {
  return {
    start_tick: beatToTicks(rules.start, ticksPerBeat),
    end_tick: beatToTicks(rules.end, ticksPerBeat),
    step_ticks: beatToTicks(rules.step, ticksPerBeat),
    pattern: rules.pattern.map((step) => ({
      choices: step.choices.map((choice) => ({
        panel_mask: choice.panel_mask,
        hold_ticks: beatToTicks(choice.hold, ticksPerBeat),
        weight: choice.weight,
      })),
    })),
  }
}

function projectIntent(
  kind: BeatEvaluationContract["intents"][number]["kind"],
  ticksPerBeat: bigint,
): GenerationProject["evaluation_contract"]["intents"][number]["kind"] {
  switch (kind.kind) {
    case "reference_accents":
      return {
        kind: "reference_accents",
        tolerance_ticks: beatToTicks(kind.tolerance, ticksPerBeat),
      }
    case "negative_space":
      return {
        kind: "negative_space",
        start_tick: beatToTicks(kind.start, ticksPerBeat),
        end_tick: beatToTicks(kind.end, ticksPerBeat),
      }
    case "relational_motif":
      return kind
  }
}
