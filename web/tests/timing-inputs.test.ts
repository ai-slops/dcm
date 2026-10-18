import { describe, expect, it } from "vitest"

import { StudioProjectV1Schema } from "../shared/index.ts"
import {
  addTempoChange,
  bpmToMicrosPerBeat,
  editTempoChange,
  removeTempoChange,
  setChartDuration,
} from "../src/domain/timing-inputs.ts"

function project() {
  return StudioProjectV1Schema.parse({
    schema_version: 1,
    title: "Timing fixture",
    artist: "PUMP",
    music: {
      duration_ticks: 64,
      ticks_per_beat: 4,
      offset_micros: 0,
      tempo: [
        { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
        { start_tick: 32, micros_per_beat: { numerator: 1_000_001, denominator: 2 } },
      ],
      audio_sha256: Array.from({ length: 32 }, () => 0),
      reference_accents: [],
    },
    chart: { ticks_per_beat: 4, span_ticks: 64, notes: [] },
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
  })
}

function projectWithConflict(conflict: "note" | "tempo" | "accent" | "window" | "intent") {
  const original = project()
  if (conflict === "note") {
    return StudioProjectV1Schema.parse({
      ...original,
      chart: { ...original.chart, notes: [{ tick: 40, panel_mask: 1, hold_ticks: 8 }] },
    })
  }
  if (conflict === "tempo") {
    return StudioProjectV1Schema.parse({
      ...original,
      music: {
        ...original.music,
        tempo: [
          { start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } },
          { start_tick: 48, micros_per_beat: { numerator: 400_000, denominator: 1 } },
        ],
      },
    })
  }
  if (conflict === "accent") {
    return StudioProjectV1Schema.parse({
      ...original,
      music: { ...original.music, reference_accents: [48] },
    })
  }
  if (conflict === "window") {
    return StudioProjectV1Schema.parse({
      ...original,
      evaluation_contract: {
        ...original.evaluation_contract,
        difficulty: {
          ...original.evaluation_contract.difficulty,
          local_windows: [{ width_ticks: 48, maximum_load: 1 }],
        },
      },
    })
  }
  return StudioProjectV1Schema.parse({
    ...original,
    evaluation_contract: {
      ...original.evaluation_contract,
      intents: [
        {
          id: "space",
          kind: { kind: "negative_space", start_tick: 8, end_tick: 48 },
          requiredness: "required",
          credit_policy: "exclusive",
          threshold: 1,
          weight: 1,
        },
      ],
    },
  })
}

describe("exact BPM input", () => {
  it("converts decimal 123.45 to a reduced exact micros-per-beat fraction", () => {
    // Given a finite decimal BPM entered by the user
    // When it crosses the timing boundary
    const result = bpmToMicrosPerBeat("123.45")

    // Then no integer-microsecond rounding is introduced
    expect(result).toEqual({
      kind: "success",
      fraction: { numerator: 400_000_000, denominator: 823 },
    })
  })

  it("converts the default 120 BPM to exactly 500000 microseconds", () => {
    // Given the common default tempo
    // When it crosses the timing boundary
    const result = bpmToMicrosPerBeat("120")

    // Then the inverse is the canonical integer fraction
    expect(result).toEqual({
      kind: "success",
      fraction: { numerator: 500_000, denominator: 1 },
    })
  })

  it.each(["0", "1000.000001", "123.4567890", "1/2", ""])(
    "rejects invalid BPM input %j",
    (input) => {
      // Given malformed or out-of-contract input
      // When it crosses the timing boundary
      const result = bpmToMicrosPerBeat(input)

      // Then it remains a visible expected error
      expect(result.kind).toBe("error")
    },
  )
})

describe("tempo map edits", () => {
  it("edits one entry without normalizing untouched imported fractions", () => {
    // Given an imported non-integer fraction at tick 32
    const original = project()
    const importedFraction = original.music.tempo[1]?.micros_per_beat

    // When only the base BPM is explicitly edited
    const result = editTempoChange(original, { originalTick: 0, tick: "0", bpm: "150" })

    // Then the imported fraction remains unchanged
    expect(result.kind).toBe("success")
    if (result.kind === "success") {
      expect(result.project.music.tempo[1]?.micros_per_beat).toEqual(importedFraction)
      expect(result.project.music.tempo[0]?.micros_per_beat).toEqual({
        numerator: 400_000,
        denominator: 1,
      })
    }
  })

  it("rejects a duplicate marker without mutating the project", () => {
    // Given a marker already at tick 32
    const original = project()
    const before = JSON.stringify(original)

    // When another marker targets the same tick
    const result = addTempoChange(original, "32", "140")

    // Then the error is explicit and old data is retained
    expect(result).toMatchObject({ kind: "error", message: expect.stringContaining("already") })
    expect(JSON.stringify(original)).toBe(before)
  })

  it("keeps markers sorted and prevents removing the base marker", () => {
    // Given a two-entry tempo map
    const original = project()

    // When a marker is inserted between them and base removal is attempted
    const added = addTempoChange(original, "16", "90")
    const removed = removeTempoChange(original, 0)

    // Then insertion is canonical and tick zero remains mandatory
    expect(added.kind).toBe("success")
    if (added.kind === "success") {
      expect(added.project.music.tempo.map((segment) => segment.start_tick)).toEqual([0, 16, 32])
    }
    expect(removed).toMatchObject({ kind: "error", message: expect.stringContaining("tick 0") })
  })
})

describe("chart duration edits", () => {
  it("extends music duration and chart span together", () => {
    // Given a valid project
    const original = project()

    // When its duration is extended
    const result = setChartDuration(original, "96")

    // Then both schema-coupled spans change atomically
    expect(result).toMatchObject({
      kind: "success",
      project: { music: { duration_ticks: 96 }, chart: { span_ticks: 96 } },
    })
  })

  it.each(["note", "tempo", "accent", "window", "intent"] as const)(
    "rejects shortening past a %s without mutation",
    (conflict) => {
      // Given timing data extending beyond the requested duration
      const candidate = projectWithConflict(conflict)
      const before = JSON.stringify(candidate)

      // When the requested span ends at tick 40
      const result = setChartDuration(candidate, "40")

      // Then the invalid shortening is visible and old data remains intact
      expect(result.kind).toBe("error")
      expect(JSON.stringify(candidate)).toBe(before)
    },
  )
})
