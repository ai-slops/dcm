import { StudioError } from "../errors.ts"
import {
  migrateLegacyChart,
  migrateLegacyComponent,
  migrateLegacyProject,
  migrateTiming,
} from "./legacy-beat-migration.ts"
import type { PersistedStateV3 } from "./state.ts"
import { beatChartSummary, PersistedStateV4Schema } from "./state-v4.ts"

export function migrateV3ToV4(state: PersistedStateV3) {
  const projects = state.projects.records.map(migrateLegacyProject)
  const components = state.projects.components.map((component) => {
    const source = state.projects.records.find(
      (project) =>
        project.id === component.source_project_id &&
        project.revision === component.source_project_revision,
    )
    return migrateLegacyComponent(component, source)
  })
  const charts = state.library.charts.map((chart) => {
    const project = migrateLegacyChart(chart.project)
    return {
      id: chart.id,
      song_id: chart.song_id,
      name: chart.name,
      ...beatChartSummary(project),
      project,
      ...(chart.generated_from === undefined
        ? {}
        : {
            generated_from: {
              project_id: chart.generated_from.project_id,
              project_revision: chart.generated_from.project_revision,
              seed: chart.generated_from.seed,
              automatic_regions: (chart.generated_from.automatic_regions ?? []).map((region) => {
                const source = state.projects.records.find(
                  (candidate) =>
                    candidate.id === chart.generated_from?.project_id &&
                    candidate.revision === chart.generated_from.project_revision,
                )
                const ticksPerBeat =
                  source?.timing.ticks_per_beat ?? chart.project.music.ticks_per_beat
                return {
                  id: region.id,
                  name: region.name,
                  start: migrateBeat(region.start_tick, ticksPerBeat),
                  end: migrateBeat(region.end_tick, ticksPerBeat),
                }
              }),
            },
          }),
    }
  })
  const active = charts.find((chart) => chart.id === state.library.active_chart_id)
  if (active === undefined)
    throw new StudioError(500, "library_corrupt", "Active chart is missing during V3 migration")
  return PersistedStateV4Schema.parse({
    version: 4,
    document: {
      revision: state.document.revision,
      project: active.project,
      ...(active.generated_from === undefined ? {} : { origin: active.generated_from }),
    },
    library: {
      ...state.library,
      songs: state.library.songs.map((song) =>
        song.archive_source === undefined
          ? song
          : {
              ...song,
              archive_source: {
                ...song.archive_source,
                timing: migrateTiming(
                  song.archive_source.timing,
                  song.archive_source.timing.ticks_per_beat * 4,
                ),
              },
            },
      ),
      charts,
    },
    projects: {
      revision: state.projects.revision,
      selected_project_id: state.projects.selected_project_id,
      records: projects,
      components,
    },
  })
}

function migrateBeat(tick: number, ticksPerBeat: number) {
  const divisor = greatestCommonDivisor(tick, ticksPerBeat)
  return { numerator: tick / divisor, denominator: ticksPerBeat / divisor }
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
