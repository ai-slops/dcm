import {
  type GenerationProject,
  GenerationProjectSchema,
  type ProjectWorkspace,
  ProjectWorkspaceSchema,
} from "../../shared/generation-projects.ts"
import { type ProjectMutation, ProjectMutationSchema } from "../../shared/project-commands.ts"

export const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as const
export const SONG_ID = "00000000-0000-4000-8000-000000000002" as const

export function fullProject(): GenerationProject {
  return GenerationProjectSchema.parse({
    schema_version: 1,
    id: PROJECT_ID,
    revision: 1,
    name: "Rules",
    song_id: SONG_ID,
    mode: "Single",
    timing: {
      duration_ticks: 96,
      ticks_per_beat: 4,
      offset_micros: 0,
      tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      reference_accents: [],
    },
    evaluation_contract: {
      schema_version: 2,
      history_policy: { recent_window: 0, max_request_history: 0 },
      foot_model: {
        version: 1,
        micros_per_panel_unit: 100_000,
        bracket_setup_micros: 100_000,
        crossover_penalty: 2,
        bracket_penalty: 3,
      },
      difficulty: {
        label: "fixture",
        density: { minimum: 0, maximum: 1_000_000 },
        movement: { minimum: 0, maximum: 1_000_000 },
        brackets: { minimum: 0, maximum: 1_000_000 },
        hold_occupancy: { minimum: 0, maximum: 1_000_000 },
        local_load: { minimum: 0, maximum: 1_000_000 },
        total: { minimum: 0, maximum: 1_000_000 },
        local_windows: [],
      },
      intents: [],
      budgets: {
        max_notes: 10_000,
        max_frames: 10_000,
        max_dp_work: 1_000_000,
        max_matching_work: 1_000_000,
      },
    },
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: 96,
      step_ticks: 48,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
    applied_components: {},
  })
}

export function workspace(): ProjectWorkspace {
  const project = fullProject()
  const {
    timing: _timing,
    evaluation_contract: _evaluation,
    generation_rules: _rules,
    ...summary
  } = project
  return ProjectWorkspaceSchema.parse({
    revision: 1,
    selected_project_id: project.id,
    projects: [summary],
    components: [],
  })
}

export function projectMutation(): ProjectMutation {
  const project = GenerationProjectSchema.parse({ ...fullProject(), revision: 2 })
  const {
    timing: _timing,
    evaluation_contract: _evaluation,
    generation_rules: _rules,
    ...summary
  } = project
  return {
    workspace: ProjectWorkspaceSchema.parse({ ...workspace(), revision: 2, projects: [summary] }),
    project,
  }
}

export function generationMutation(): ProjectMutation {
  const objectives = { movement: 0, brackets: 0, crossover: 0, hold_occupancy: 0 }
  const signals = {
    density: 0,
    movement: 0,
    brackets: 0,
    hold_occupancy: 0,
    local_load: 0,
    total: 0,
  }
  const rejection = {
    kind: "physical" as const,
    rule_id: null,
    observed: null,
    required: null,
    frame: 0,
    explanation: "fixture",
  }
  return ProjectMutationSchema.parse({
    workspace: workspace(),
    generation: {
      schema_version: 1,
      chart_id: "00000000-0000-4000-8000-000000000003",
      project_id: PROJECT_ID,
      project_revision: 1,
      seed: "0".repeat(64),
      mode: "Single",
      chart: {
        ticks_per_beat: 4,
        span_ticks: 96,
        notes: [{ tick: 0, panel_mask: 3, hold_ticks: 0 }],
      },
      assessment: {
        schema_version: 2,
        accepted: false,
        execution: {
          model_version: 1,
          feasible: false,
          best_path: null,
          alternative_path_exists: false,
          min_objectives: objectives,
          max_objectives: objectives,
          min_total_objective: 0,
          max_total_objective: 0,
          earliest_infeasible_frame: 0,
          feasible_contacts_by_frame: [],
          route_windows: [],
        },
        difficulty: {
          model: "fixture",
          uncalibrated: true,
          minimum: signals,
          maximum: signals,
          local_windows: [],
          rejections: [rejection],
        },
        intents: {
          scores: {
            reference_accents: 0,
            negative_space: 0,
            relational_motifs: 0,
            required_credit: 0,
            optional_credit: 0,
          },
          evidence: [],
          rejections: [],
        },
        rejections: [rejection],
      },
      ucs_validation: { valid: true, byte_length: 10 },
      request_sha256: "1".repeat(64),
      certification: { status: "none", reason: "not_generated_from_verified_bundle" },
    },
  })
}
