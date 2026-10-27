import type { EvalContract } from "../../shared/evaluation-contract.ts"
import { EvalContractSchema } from "../../shared/evaluation-contract.ts"
import type { GenerationProject, MusicTiming } from "../../shared/generation-projects.ts"
import { MusicTimingSchema } from "../../shared/generation-projects.ts"
import type { GenerationRules } from "../../shared/generation-rules.ts"
import { GenerationRulesSchema } from "../../shared/generation-rules.ts"
import { LibraryLabelSchema } from "../../shared/library.ts"
import type { StudioProjectV1, UcsMode } from "../../shared/project.ts"

export type ProjectFormValue = {
  readonly name: string
  readonly mode: UcsMode
  readonly timing: MusicTiming
  readonly evaluationContract: EvalContract
  readonly generationRules: GenerationRules
}

export function initialProjectJson(project: GenerationProject | StudioProjectV1): {
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
} {
  if ("generation_rules" in project) {
    return {
      timing: pretty(project.timing),
      evaluation: pretty(project.evaluation_contract),
      rules: pretty(project.generation_rules),
    }
  }
  const { audio_sha256: _audio, ...timing } = project.music
  return {
    timing: pretty(timing),
    evaluation: pretty(project.evaluation_contract),
    rules: pretty({
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: timing.duration_ticks,
      step_ticks: timing.ticks_per_beat,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    }),
  }
}

export function parseProjectForm(input: {
  readonly name: string
  readonly mode: "" | UcsMode
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
}): ProjectFormValue {
  if (input.mode === "") throw new ProjectFormError("Choose Single or Double mode")
  try {
    return {
      name: LibraryLabelSchema.parse(input.name),
      mode: input.mode,
      timing: MusicTimingSchema.parse(JSON.parse(input.timing)),
      evaluationContract: EvalContractSchema.parse(JSON.parse(input.evaluation)),
      generationRules: GenerationRulesSchema.parse(JSON.parse(input.rules)),
    }
  } catch (error) {
    if (error instanceof Error) throw new ProjectFormError(error.message)
    throw error
  }
}

export class ProjectFormError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectFormError"
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
