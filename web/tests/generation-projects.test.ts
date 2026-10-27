import { describe, expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { GenerationProjectSchema } from "../shared/generation-projects.ts"
import { repoRoot } from "./support/paths.ts"

async function projectInput() {
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audio, ...timing } = demo.document.project.music
  return {
    schema_version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    name: "Authored rules",
    song_id: "00000000-0000-4000-8000-000000000002",
    mode: "Single",
    timing,
    evaluation_contract: demo.document.project.evaluation_contract,
    generation_rules: {
      schema_version: 1,
      algorithm: "weighted_cycle_v1",
      start_tick: 0,
      end_tick: timing.duration_ticks,
      step_ticks: 48,
      pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
    },
    applied_components: {},
  }
}

describe("generation project boundaries", () => {
  it("requires an explicit mode rather than inferring Double", async () => {
    const { mode: _mode, ...input } = await projectInput()
    expect(GenerationProjectSchema.safeParse(input).success).toBe(false)
  })

  it("rejects right-pad generation rules in a Single project", async () => {
    const input = await projectInput()
    input.generation_rules.pattern = [{ choices: [{ panel_mask: 32, hold_ticks: 0, weight: 1 }] }]
    expect(GenerationProjectSchema.safeParse(input).success).toBe(false)
    expect(GenerationProjectSchema.safeParse({ ...input, mode: "Double" }).success).toBe(true)
  })

  it("rejects rules outside the project timing instead of truncating them", async () => {
    const input = await projectInput()
    input.generation_rules.end_tick = input.timing.duration_ticks + 1
    expect(GenerationProjectSchema.safeParse(input).success).toBe(false)
  })

  it("bounds generated slots before expensive native evaluation", async () => {
    const input = await projectInput()
    input.timing.duration_ticks = 1_000_000
    input.generation_rules.end_tick = 1_000_000
    input.generation_rules.step_ticks = 1
    expect(GenerationProjectSchema.safeParse(input).success).toBe(false)
  })

  it("keeps background audio identity out of reusable project timing", async () => {
    const input = await projectInput()
    expect(GenerationProjectSchema.safeParse(input).success).toBe(true)
    expect(
      GenerationProjectSchema.safeParse({
        ...input,
        timing: { ...input.timing, audio_sha256: Array.from({ length: 32 }, () => 0) },
      }).success,
    ).toBe(false)
  })
})
