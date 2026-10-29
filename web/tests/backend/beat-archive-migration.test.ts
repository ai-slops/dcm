import { expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { migrateV3ToV4 } from "../../server/library/migrate-v3-v4.ts"
import { initialState, PersistedStateV3Schema } from "../../server/library/state.ts"
import { repoRoot } from "../support/paths.ts"

it("preserves a legacy archive timing grid at four rows per source tick", async () => {
  // Given
  const demo = await loadDemo(repoRoot)
  const legacy = initialState(demo.document)
  const archiveId = "00000000-0000-4000-8000-000000000020"
  const state = PersistedStateV3Schema.parse({
    ...legacy,
    library: {
      ...legacy.library,
      archives: [
        {
          id: archiveId,
          name: "legacy.zip",
          sha256: "1".repeat(64),
          byte_length: 1,
          chart_names: ["chart.ucs"],
          audio_names: ["music.wav"],
        },
      ],
      songs: legacy.library.songs.map((song) => ({
        ...song,
        archive_id: archiveId,
        archive_source: {
          chart_name: "chart.ucs",
          audio_name: "music.wav",
          mode: "Double",
          timing: {
            duration_ticks: 4_096,
            ticks_per_beat: 4_096,
            offset_micros: 0,
            tempo: [
              {
                start_tick: 0,
                micros_per_beat: { numerator: 500_000, denominator: 1 },
              },
            ],
            reference_accents: [],
          },
        },
      })),
    },
  })

  // When
  const migrated = migrateV3ToV4(state)

  // Then
  expect(migrated.library.songs[0]?.archive_source?.timing.grid_sections[0]).toEqual({
    at: { numerator: 0, denominator: 1 },
    rows_per_measure: 16_384,
  })
})
