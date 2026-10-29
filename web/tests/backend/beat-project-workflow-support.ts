import { ProjectService } from "../../server/projects/service.ts"
import type { StudioStore } from "../../server/store.ts"

export function projectService(store: StudioStore): ProjectService {
  return new ProjectService(store, {
    generate: () => Promise.reject(new Error("generation not expected")),
  })
}

export function weightedRules(
  duration: { readonly numerator: number; readonly denominator: number } | null,
) {
  if (duration === null) throw new Error("Expected explicit migrated duration")
  return {
    schema_version: 1 as const,
    algorithm: "weighted_cycle_v1" as const,
    start: { numerator: 0, denominator: 1 },
    end: duration,
    step: { numerator: 2, denominator: 1 },
    pattern: [
      {
        choices: [
          {
            panel_mask: 1,
            hold: { numerator: 0, denominator: 1 },
            weight: 1,
          },
        ],
      },
    ],
  }
}
