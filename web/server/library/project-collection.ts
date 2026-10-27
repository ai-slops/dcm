import { z } from "zod"

import {
  GenerationProjectSchema,
  ReusableComponentSchema,
} from "../../shared/generation-projects.ts"
import {
  GenerationProjectIdSchema,
  WorkspaceRevisionSchema,
} from "../../shared/project-identities.ts"

export const PersistedProjectsSchema = z
  .strictObject({
    revision: WorkspaceRevisionSchema,
    selected_project_id: GenerationProjectIdSchema.nullable(),
    records: z.array(GenerationProjectSchema).max(64).readonly(),
    components: z.array(ReusableComponentSchema).max(128).readonly(),
  })
  .superRefine((projects, context) => {
    const ids = new Set(projects.records.map((project) => project.id))
    if (projects.selected_project_id !== null && !ids.has(projects.selected_project_id))
      context.addIssue({
        code: "custom",
        path: ["selected_project_id"],
        message: "selected project is missing",
      })
  })
  .readonly()
