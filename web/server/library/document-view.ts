import { type CurrentDocument, CurrentDocumentSchema } from "../../shared/api.ts"
import type { PersistedStateV3 } from "./state.ts"

export function currentDocument(state: PersistedStateV3): CurrentDocument {
  const active = state.library.charts.find((chart) => chart.id === state.library.active_chart_id)
  const generated = active?.generated_from
  return CurrentDocumentSchema.parse({
    ...state.document,
    ...(generated === undefined
      ? {}
      : {
          origin: {
            project_id: generated.project_id,
            project_revision: generated.project_revision,
            automatic_regions: generated.automatic_regions ?? [],
          },
        }),
  })
}
