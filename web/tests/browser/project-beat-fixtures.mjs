import assert from "node:assert/strict"
import { compareBeats } from "../../shared/beat.ts"
import { BaseUcsSourceOptionsSchema } from "../../shared/beat-projects.ts"

export const ZERO_BEAT = { numerator: 0, denominator: 1 }
export const ONE_BEAT = { numerator: 1, denominator: 1 }

export async function projectBaseSources(context, url, songId) {
  const response = await context.request.get(
    new URL(`/api/v1/projects/base-sources/${songId}`, url).toString(),
  )
  assert.equal(response.status(), 200)
  return BaseUcsSourceOptionsSchema.parse(await response.json())
}

export function savedChartBase(sources, chartId) {
  const source = sources.find(
    (candidate) => candidate.ref.source === "saved_chart" && candidate.ref.chart_id === chartId,
  )
  assert.ok(source, `Expected saved chart base ${chartId}`)
  return source
}

export function archiveTimingBase(sources) {
  const source = sources.find((candidate) => candidate.ref.source === "archive_entry")
  assert.ok(source, "Expected archive timing base")
  return source
}

export function automaticTiming(source) {
  return { ...source.timing, duration: null }
}

export function weightedRules(input) {
  const boundedEnd = { numerator: 8, denominator: 1 }
  return {
    schema_version: 1,
    algorithm: "weighted_cycle_v1",
    start: ZERO_BEAT,
    end: compareBeats(input.end, boundedEnd) > 0 ? boundedEnd : input.end,
    step: input.step ?? ONE_BEAT,
    pattern: [
      {
        choices: [{ panel_mask: input.panelMask, hold: ZERO_BEAT, weight: 1 }],
      },
    ],
  }
}

export function sourceKey(source) {
  switch (source.source) {
    case "archive_entry":
      return `archive:${source.archive_id}:${source.entry_name}`
    case "saved_chart":
      return `chart:${source.chart_id}`
    case "retained_timing":
      return `retained:${source.song_id}`
    default:
      throw new TypeError(`Unsupported base source ${String(source.source)}`)
  }
}

export function beatValue(beat) {
  return beat.numerator / beat.denominator
}

export function timingWithExactTail(projectTiming, baseTiming) {
  return {
    ...projectTiming,
    duration: { numerator: 5, denominator: 1 },
    tempo: [
      ...baseTiming.tempo,
      {
        at: { numerator: 3, denominator: 1 },
        micros_per_beat: { numerator: 2_400_000, denominator: 7 },
      },
    ],
  }
}

export function assertExactTailTiming(actual, baseTiming) {
  assert.deepEqual(actual.duration, { numerator: 5, denominator: 1 })
  assert.equal(actual.offset_micros, baseTiming.offset_micros)
  assert.deepEqual(actual.tempo.slice(0, 2), baseTiming.tempo)
  assert.deepEqual(actual.tempo[2], {
    at: { numerator: 3, denominator: 1 },
    micros_per_beat: { numerator: 2_400_000, denominator: 7 },
  })
}
