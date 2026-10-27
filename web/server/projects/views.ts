import type { z } from "zod"
import type {
  GenerationProject,
  GenerationProjectSummary,
  ReusableComponent,
  ReusableComponentSummarySchema,
} from "../../shared/generation-projects.ts"

type ReusableComponentSummary = z.infer<typeof ReusableComponentSummarySchema>

export function projectSummary(project: GenerationProject): GenerationProjectSummary {
  return {
    schema_version: project.schema_version,
    id: project.id,
    revision: project.revision,
    name: project.name,
    song_id: project.song_id,
    mode: project.mode,
    applied_components: project.applied_components,
  }
}

export function componentSummary(component: ReusableComponent): ReusableComponentSummary {
  return {
    id: component.id,
    revision: component.revision,
    name: component.name,
    kind: component.kind,
    source_project_id: component.source_project_id,
    source_project_revision: component.source_project_revision,
  }
}
