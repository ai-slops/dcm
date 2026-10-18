import { z } from "zod"

import { FractionSchema, NonNegativeIntegerSchema } from "./native.ts"

const MetricVectorSchema = z
  .strictObject({
    movement: NonNegativeIntegerSchema,
    brackets: NonNegativeIntegerSchema,
    crossover: NonNegativeIntegerSchema,
    hold_occupancy: NonNegativeIntegerSchema,
  })
  .readonly()

const FootPoseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("off") }).readonly(),
  z.strictObject({ kind: z.literal("single"), panel: NonNegativeIntegerSchema.max(9) }).readonly(),
  z
    .strictObject({
      kind: z.literal("bracket"),
      first: NonNegativeIntegerSchema.max(9),
      second: NonNegativeIntegerSchema.max(9),
    })
    .readonly(),
])

const ContactSchema = z
  .strictObject({
    frame: NonNegativeIntegerSchema,
    tick: NonNegativeIntegerSchema,
    poses: z.strictObject({ left: FootPoseSchema, right: FootPoseSchema }).readonly(),
  })
  .readonly()

const RejectionSchema = z
  .strictObject({
    kind: z.enum(["physical", "difficulty_minimum", "difficulty_maximum", "intent_threshold"]),
    rule_id: z.string().nullable(),
    observed: NonNegativeIntegerSchema.nullable(),
    required: NonNegativeIntegerSchema.nullable(),
    frame: NonNegativeIntegerSchema.nullable(),
    explanation: z.string(),
  })
  .readonly()

const DifficultySignalsSchema = z
  .strictObject({
    density: NonNegativeIntegerSchema,
    movement: NonNegativeIntegerSchema,
    brackets: NonNegativeIntegerSchema,
    hold_occupancy: NonNegativeIntegerSchema,
    local_load: NonNegativeIntegerSchema,
    total: NonNegativeIntegerSchema,
  })
  .readonly()

export const NativeAssessmentSchema = z
  .strictObject({
    schema_version: z.literal(2),
    accepted: z.boolean(),
    execution: z
      .strictObject({
        model_version: NonNegativeIntegerSchema,
        feasible: z.boolean(),
        best_path: z
          .strictObject({
            contacts: z.array(ContactSchema).readonly(),
            objectives: MetricVectorSchema,
          })
          .readonly()
          .nullable(),
        alternative_path_exists: z.boolean(),
        min_objectives: MetricVectorSchema,
        max_objectives: MetricVectorSchema,
        min_total_objective: NonNegativeIntegerSchema,
        max_total_objective: NonNegativeIntegerSchema,
        earliest_infeasible_frame: NonNegativeIntegerSchema.nullable(),
        feasible_contacts_by_frame: z.array(z.array(ContactSchema).readonly()).readonly(),
        route_windows: z
          .array(
            z
              .strictObject({
                rule_index: NonNegativeIntegerSchema,
                start_tick: NonNegativeIntegerSchema,
                end_tick: NonNegativeIntegerSchema,
                minimum_movement: NonNegativeIntegerSchema,
                maximum_movement: NonNegativeIntegerSchema,
              })
              .readonly(),
          )
          .readonly(),
      })
      .readonly(),
    difficulty: z
      .strictObject({
        model: z.string(),
        uncalibrated: z.boolean(),
        minimum: DifficultySignalsSchema,
        maximum: DifficultySignalsSchema,
        local_windows: z
          .array(
            z
              .strictObject({
                start_tick: NonNegativeIntegerSchema,
                end_tick: NonNegativeIntegerSchema,
                duration_micros: FractionSchema,
                minimum_load: NonNegativeIntegerSchema,
                maximum_load: NonNegativeIntegerSchema,
              })
              .readonly(),
          )
          .readonly(),
        rejections: z.array(RejectionSchema).readonly(),
      })
      .readonly(),
    intents: z
      .strictObject({
        scores: z
          .strictObject({
            reference_accents: NonNegativeIntegerSchema,
            negative_space: NonNegativeIntegerSchema,
            relational_motifs: NonNegativeIntegerSchema,
            required_credit: NonNegativeIntegerSchema,
            optional_credit: NonNegativeIntegerSchema,
          })
          .readonly(),
        evidence: z
          .array(
            z
              .strictObject({
                intent_id: z.string(),
                score: NonNegativeIntegerSchema,
                credited: NonNegativeIntegerSchema,
                supporting_note_indices: z.array(NonNegativeIntegerSchema).readonly(),
                explanation: z.string(),
              })
              .readonly(),
          )
          .readonly(),
        rejections: z.array(RejectionSchema).readonly(),
      })
      .readonly(),
    rejections: z.array(RejectionSchema).readonly(),
  })
  .readonly()

export const EvaluationSummarySchema = z
  .strictObject({
    label: z.literal("finite_model"),
    accepted: z.boolean(),
    uncalibrated: z.boolean(),
    rejection_count: NonNegativeIntegerSchema,
  })
  .readonly()

export const EvaluationResponseSchema = z
  .strictObject({
    summary: EvaluationSummarySchema,
    raw_native: NativeAssessmentSchema,
  })
  .readonly()

export type NativeAssessment = z.infer<typeof NativeAssessmentSchema>
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>
