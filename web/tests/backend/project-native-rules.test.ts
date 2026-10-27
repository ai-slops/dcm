import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import {
  materializeNativeMusic,
  ProjectNativeService,
  parseNativeRuleGeneration,
} from "../../server/native/project-rules.ts"
import type { AudioRecord } from "../../server/store.ts"
import {
  type GenerationProject,
  GenerationProjectSchema,
} from "../../shared/generation-projects.ts"
import { NativeMusicSchema } from "../../shared/native.ts"
import { repoRoot } from "../support/paths.ts"

async function fixture(): Promise<{
  readonly project: GenerationProject
  readonly audio: AudioRecord
}> {
  const demo = await loadDemo(repoRoot)
  const { audio_sha256: _audioDigest, ...timing } = demo.document.project.music
  return {
    audio: {
      bytes: demo.audio,
      digest: createHash("sha256").update(demo.audio).digest("hex"),
      format: "wav",
    },
    project: GenerationProjectSchema.parse({
      schema_version: 1,
      id: "00000000-0000-4000-8000-000000000001",
      revision: 0,
      name: "Native rules",
      song_id: "00000000-0000-4000-8000-000000000002",
      mode: "Single",
      timing,
      evaluation_contract: demo.document.project.evaluation_contract,
      generation_rules: {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: 16,
        step_ticks: 4,
        pattern: [
          {
            choices: [
              { panel_mask: 1, hold_ticks: 0, weight: 1 },
              { panel_mask: 2, hold_ticks: 0, weight: 3 },
            ],
          },
        ],
      },
      applied_components: {},
    }),
  }
}

describe("ProjectNativeService", () => {
  it("rejects a native mode mismatch before accepting the remaining payload", () => {
    expect(() =>
      parseNativeRuleGeneration('{"mode":"Double"}', "Single", {
        schema_version: 1,
        algorithm: "weighted_cycle_v1",
        start_tick: 0,
        end_tick: 4,
        step_ticks: 4,
        pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
      }),
    ).toThrowError("Native rule generator returned mode Double for Single project")
  })

  it("binds reusable timing to the selected background audio digest", async () => {
    const { project, audio } = await fixture()

    const music = materializeNativeMusic(project, audio)

    expect(NativeMusicSchema.parse(music).audio_sha256).toEqual(
      Array.from(Buffer.from(audio.digest, "hex")),
    )
  })

  it("drives the actual native CLI deterministically without the demo author profile", async () => {
    const { project, audio } = await fixture()
    const native = new ProjectNativeService(repoRoot)
    const seed = "07".repeat(32)

    const first = await native.generate(project, audio, seed)
    const second = await native.generate(project, audio, seed)

    expect(first.chart).toEqual(second.chart)
    expect(first.request_sha256).toBe(second.request_sha256)
    expect(first.chart.notes).toHaveLength(4)
    expect(first.mode).toBe("Single")
    expect(first.certification).toEqual({
      status: "none",
      reason: "not_generated_from_verified_bundle",
    })
  })

  it("composes fixed notes with named automatic regions through the actual native CLI", async () => {
    const { project, audio } = await fixture()
    const hybrid = GenerationProjectSchema.parse({
      ...project,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [{ tick: 2, panel_mask: 16, hold_ticks: 0 }],
        regions: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Verse",
            rules: {
              start_tick: 4,
              end_tick: 12,
              step_ticks: 4,
              pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
            },
          },
        ],
      },
    })
    const native = new ProjectNativeService(repoRoot)

    const generated = await native.generate(hybrid, audio, "07".repeat(32))

    expect(generated.chart.notes).toEqual([
      { tick: 2, panel_mask: 16, hold_ticks: 0 },
      { tick: 4, panel_mask: 1, hold_ticks: 0 },
      { tick: 8, panel_mask: 1, hold_ticks: 0 },
    ])
    expect(generated.ucs_validation.valid).toBe(true)
  })

  it("rejects UCS-tail collisions from a hybrid native response", async () => {
    const { project, audio } = await fixture()
    const native = new ProjectNativeService(repoRoot)
    const generated = await native.generate(project, audio, "07".repeat(32))
    const hybridRules = GenerationProjectSchema.parse({
      ...project,
      generation_rules: {
        schema_version: 2,
        algorithm: "hybrid_regions_v1",
        fixed_notes: [],
        regions: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Verse",
            rules: {
              start_tick: 0,
              end_tick: 12,
              step_ticks: 4,
              pattern: [{ choices: [{ panel_mask: 1, hold_ticks: 0, weight: 1 }] }],
            },
          },
        ],
      },
    }).generation_rules
    const encoded = JSON.stringify({
      ...generated,
      chart: {
        ...generated.chart,
        notes: [
          { tick: 0, panel_mask: 1, hold_ticks: 4 },
          { tick: 4, panel_mask: 1, hold_ticks: 0 },
        ],
      },
    })

    expect(() => parseNativeRuleGeneration(encoded, "Single", hybridRules)).toThrowError(
      "already contains a note or hold tail",
    )
  })
})
