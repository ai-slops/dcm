import { normalizeChartDocument } from "../../shared/project.ts"
import { type PersistedStateV2, type PersistedStateV3, PersistedStateV3Schema } from "./state.ts"

export function migrateV2ToV3(state: PersistedStateV2): PersistedStateV3 {
  const charts = state.library.charts.map((chart) => ({
    ...chart,
    project: normalizeChartDocument(chart.project),
  }))
  return PersistedStateV3Schema.parse({
    version: 3,
    document: { ...state.document, project: normalizeChartDocument(state.document.project) },
    library: { ...state.library, charts },
    projects: { revision: 0, selected_project_id: null, records: [], components: [] },
  })
}
