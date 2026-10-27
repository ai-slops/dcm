import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import {
  AgentRunRequestSchema,
  AgentRunSnapshotSchema,
  AgentStreamEventSchema,
  BootstrapSchema,
  canonicalizeChart,
  EvalContractSchema,
  StudioProjectV1Schema,
} from "../shared/index.ts"
import { repoRoot } from "./support/paths.ts"

describe("canonicalizeChart", () => {
  it("merges panel masks when tick and hold duration match", () => {
    // Given
    const chart = {
      ticks_per_beat: 4,
      span_ticks: 32,
      notes: [
        { tick: 8, panel_mask: 2, hold_ticks: 0 },
        { tick: 8, panel_mask: 1, hold_ticks: 0 },
      ],
    }

    // When
    const result = canonicalizeChart(chart)

    // Then
    expect(result.notes).toEqual([{ tick: 8, panel_mask: 3, hold_ticks: 0 }])
  })
})

describe("StudioProjectV1Schema", () => {
  it("rejects a chart whose span differs from the music", () => {
    // Given
    const project = {
      schema_version: 1,
      title: "Fixture",
      artist: "PUMP",
      music: {
        duration_ticks: 32,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        audio_sha256: Array.from({ length: 32 }, () => 0),
        reference_accents: [],
      },
      chart: { ticks_per_beat: 4, span_ticks: 16, notes: [] },
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
      audio_asset: { format: "wav", byte_length: 44 },
    }

    // When
    const result = StudioProjectV1Schema.safeParse(project)

    // Then
    expect(result.success).toBe(false)
  })
})

describe("EvalContractSchema", () => {
  it("rejects more intents than the native matching-work budget", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const contract = {
      ...demo.document.project.evaluation_contract,
      intents: ["first", "second", "third"].map((id) => ({
        id,
        kind: { kind: "reference_accents" as const, tolerance_ticks: 0 },
        requiredness: "required" as const,
        credit_policy: "shared" as const,
        threshold: 1,
        weight: 1,
      })),
      budgets: {
        ...demo.document.project.evaluation_contract.budgets,
        max_matching_work: 1,
      },
    }

    // When
    const result = EvalContractSchema.safeParse(contract)

    // Then
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["intents"])
  })
})

describe("agent recovery contracts", () => {
  it("defaults legacy run requests to read-only project access", () => {
    // Given
    const request = { base_revision: 3, prompt: "Inspect" }

    // When
    const parsed = AgentRunRequestSchema.parse(request)

    // Then
    expect(parsed.write_access).toBe("read_only")
  })

  it("retains explicit project write access in a run snapshot", () => {
    // Given
    const snapshot = {
      id: "run-1",
      base_revision: 3,
      status: "running",
      prompt: "Update project rules",
      last_sequence: 2,
      write_access: "projects_and_components",
    }

    // When
    const parsed = AgentRunSnapshotSchema.parse(snapshot)

    // Then
    expect(parsed.write_access).toBe("projects_and_components")
  })

  it("parses bounded canonical tool state and proposal decisions", () => {
    // Given
    const snapshot = {
      id: "run-1",
      base_revision: 3,
      status: "completed",
      prompt: "Inspect",
      last_sequence: 8,
      text: "Done",
      model: "gpt-6.1-sol",
      api: "responses",
      tool_calls: [
        {
          id: "call-1",
          tool_id: "validate_ucs",
          state: "completed",
          input_preview: '{"mode":"Double"}',
          output_preview: '{"valid":true}',
        },
      ],
      proposal_decisions: [
        { id: "proposal-1", status: "applied", revision: 4, summary: "Applied timing edit" },
      ],
    }

    // When
    const result = AgentRunSnapshotSchema.safeParse(snapshot)

    // Then
    expect(result.success).toBe(true)
  })

  it("parses failed tool detail without exposing an unbounded payload", () => {
    // Given
    const event = {
      run_id: "run-1",
      sequence: 4,
      type: "tool",
      tool_id: "evaluate_chart",
      call_id: "call-1",
      state: "failed",
      input_preview: "{}",
      error: { code: "native_unavailable", message: "Native runtime is unavailable" },
    }

    // When
    const result = AgentStreamEventSchema.safeParse(event)

    // Then
    expect(result.success).toBe(true)
  })

  it("parses provider discovery, tool availability, and recent terminal runs on bootstrap", () => {
    // Given
    const project = StudioProjectV1Schema.parse({
      schema_version: 1,
      title: "Fixture",
      artist: "PUMP",
      music: {
        duration_ticks: 32,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
        audio_sha256: Array.from({ length: 32 }, () => 0),
        reference_accents: [],
      },
      chart: { ticks_per_beat: 4, span_ticks: 32, notes: [] },
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
          density: { minimum: 0, maximum: 1 },
          movement: { minimum: 0, maximum: 1 },
          brackets: { minimum: 0, maximum: 1 },
          hold_occupancy: { minimum: 0, maximum: 1 },
          local_load: { minimum: 0, maximum: 1 },
          total: { minimum: 0, maximum: 1 },
          local_windows: [],
        },
        intents: [],
        budgets: { max_notes: 10, max_frames: 10, max_dp_work: 10, max_matching_work: 10 },
      },
      audio_asset: { format: "wav", byte_length: 44 },
    })
    const bootstrap = {
      document: { revision: 3, project },
      csrf_token: "csrf",
      session_id: "session-1",
      native: { ready: true, message: "ready" },
      proposals: [],
      active_run: null,
      agent: {
        configured: true,
        provider: "DIM workspace router",
        model: null,
        source: "dim",
        api: null,
        runtime: "@slop-lab/part@0.1.0",
        models: [{ id: "gpt-6.1-sol", name: "GPT", api: "responses" }],
      },
      tools: [{ id: "read_document", description: "Read project", available: true }],
      recent_runs: [],
    }

    // When
    const result = BootstrapSchema.safeParse(bootstrap)

    // Then
    expect(result.success).toBe(true)
  })
})
