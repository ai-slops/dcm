import type { z } from "zod"
import type {
  BeatReusableComponent,
  GenerationProjectV2,
  GenerationProjectV2SummarySchema,
} from "../../shared/beat-projects.ts"

type GenerationProjectV2Summary = z.infer<typeof GenerationProjectV2SummarySchema>

export function projectSummary(project: GenerationProjectV2): GenerationProjectV2Summary {
  return {
    schema_version: project.schema_version,
    id: project.id,
    revision: project.revision,
    name: project.name,
    song_id: project.song_id,
    mode: project.mode,
    chart_artist: project.chart_artist,
    base_ucs_ref: project.base_ucs_ref,
    applied_components: project.applied_components,
  }
}

export function componentSummary(component: BeatReusableComponent): BeatReusableComponent {
  return component
}
