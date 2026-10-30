import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { StudioProjectV1Schema } from "../shared/index.ts"
import { projectWithTiming } from "../src/ui/Studio.tsx"
import { repoRoot } from "./support/paths.ts"

it("rejects a root timing change that truncates existing notes", async () => {
  const demo = await loadDemo(repoRoot)
  const project = migrateLegacyChart(StudioProjectV1Schema.parse(demo.document.project))
  const shortened = {
    ...project.timing,
    duration: { numerator: 1, denominator: 1 },
  } as const

  expect(() => projectWithTiming(project, shortened)).toThrow("note exceeds duration")
  expect(project.timing.duration).not.toEqual(shortened.duration)
})
