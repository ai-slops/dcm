import type { BeatTiming } from "../../shared/beat.ts"
import { BeatTimingSchema } from "../../shared/beat.ts"
import type { BeatEvaluationContract } from "../../shared/beat-evaluation.ts"
import { BeatEvaluationContractSchema } from "../../shared/beat-evaluation.ts"
import type { BeatChartDocument, GenerationProjectV2 } from "../../shared/beat-projects.ts"
import type { BeatGenerationRules } from "../../shared/beat-rules.ts"
import { BeatGenerationRulesSchema } from "../../shared/beat-rules.ts"
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

export type BeatProjectFormValue = {
  readonly name: string
  readonly mode: UcsMode
  readonly timing: BeatTiming
  readonly evaluationContract: BeatEvaluationContract
  readonly generationRules: BeatGenerationRules
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
    timing: projectTimingJson(timing),
    evaluation: pretty(project.evaluation_contract),
    rules: emptyHybridRulesJson(),
  }
}

export function initialBeatProjectJson(project: GenerationProjectV2): {
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
} {
  return {
    timing: pretty(project.timing),
    evaluation: pretty(project.evaluation_contract),
    rules: pretty(project.generation_rules),
  }
}

export function beatTemplateJson(template: BeatChartDocument): {
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
} {
  return {
    timing: pretty({ ...template.timing, duration: null }),
    evaluation: pretty(template.evaluation_contract),
    rules: emptyBeatHybridRulesJson(),
  }
}

export function emptyBeatHybridRulesJson(): string {
  return pretty({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [],
    regions: [],
  })
}

export function projectTimingJson(timing: MusicTiming): string {
  return pretty(timing)
}

export function emptyHybridRulesJson(): string {
  return pretty({
    schema_version: 2,
    algorithm: "hybrid_regions_v1",
    fixed_notes: [],
    regions: [],
  })
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

export function parseBeatProjectForm(input: {
  readonly name: string
  readonly mode: "" | UcsMode
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
}): BeatProjectFormValue {
  if (input.mode === "") throw new ProjectFormError("Choose Single or Double mode")
  try {
    return {
      name: LibraryLabelSchema.parse(input.name),
      mode: input.mode,
      timing: BeatTimingSchema.parse(JSON.parse(input.timing)),
      evaluationContract: BeatEvaluationContractSchema.parse(JSON.parse(input.evaluation)),
      generationRules: BeatGenerationRulesSchema.parse(JSON.parse(input.rules)),
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
