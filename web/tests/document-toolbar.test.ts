import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import {
  BootstrapSchema,
  type CurrentDocument,
  RevisionSchema,
  StudioProjectV1Schema,
} from "../shared/index.ts"
import { DocumentToolbar } from "../src/ui/DocumentToolbar.tsx"

const project = migrateLegacyChart(
  StudioProjectV1Schema.parse({
    schema_version: 1,
    title: "Toolbar test",
    artist: "Test artist",
    music: {
      duration_ticks: 8,
      offset_micros: 0,
      ticks_per_beat: 4,
      tempo: [{ start_tick: 0, micros_per_beat: { numerator: 500_000, denominator: 1 } }],
      audio_sha256: Array.from({ length: 32 }, () => 0),
      reference_accents: [],
    },
    chart: { ticks_per_beat: 4, span_ticks: 8, notes: [] },
    evaluation_contract: {
      schema_version: 2,
      history_policy: { recent_window: 0, max_request_history: 0 },
      foot_model: {
        version: 1,
        micros_per_panel_unit: 100_000,
        bracket_setup_micros: 100_000,
        crossover_penalty: 2,
        bracket_penalty: 3,
      },
      difficulty: {
        label: "fixture",
        density: { minimum: 0, maximum: 1_000_000 },
        movement: { minimum: 0, maximum: 1_000_000 },
        brackets: { minimum: 0, maximum: 1_000_000 },
        hold_occupancy: { minimum: 0, maximum: 1_000_000 },
        local_load: { minimum: 0, maximum: 1_000_000 },
        total: { minimum: 0, maximum: 1_000_000 },
        local_windows: [],
      },
      intents: [],
      budgets: {
        max_notes: 10_000,
        max_frames: 10_000,
        max_dp_work: 1_000_000,
        max_matching_work: 1_000_000,
      },
    },
    audio_asset: { format: "wav", byte_length: 44 },
  }),
)

const revision = RevisionSchema.parse(0)
const bootstrap = BootstrapSchema.parse({
  document: { project, revision },
  csrf_token: "csrf",
  session_id: "session",
  native: { ready: false, message: "Unavailable" },
  agent: { configured: false, provider: null, model: null },
  proposals: [],
  active_run: null,
})

function renderToolbar(status: string, dirty: boolean): string {
  return renderToStaticMarkup(
    createElement(DocumentToolbar, {
      bootstrap,
      document: bootstrap.document,
      project,
      revision,
      dirty,
      status,
      canUndo: false,
      canRedo: false,
      undo: () => undefined,
      redo: () => undefined,
      save: () => Promise.resolve(null),
      onDocument: (_document: CurrentDocument) => undefined,
      onProposal: () => undefined,
      onStatus: () => undefined,
    }),
  )
}

describe("document toolbar save control", () => {
  it.each([
    { status: "Saved", dirty: false, name: "Saved" },
    { status: "Dirty", dirty: true, name: "Save" },
    { status: "Saving", dirty: true, name: "Saving" },
  ])("includes its visible $name label in the accessible name", ({ status, dirty, name }) => {
    // Given / When
    const markup = renderToolbar(status, dirty)

    // Then
    expect(markup).toContain(`aria-label="${name}"`)
  })

  it("separates song and chart management from rule projects and reusable components", () => {
    // Given / When
    const markup = renderToolbar("Saved", false)

    // Then
    expect(markup).toContain('aria-label="Songs and charts"')
    expect(markup).toContain('aria-label="Projects and library"')
    expect(markup).not.toContain('aria-label="Import and audio"')
  })
})
