import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { ArchiveIdSchema, ChartIdSchema, SongIdSchema } from "../shared/library.ts"
import { ProjectBaseTimingPicker } from "../src/ui/ProjectBaseTimingPicker.tsx"

it("requires an explicit archive UCS or stored-chart timing source", () => {
  // Given / When
  const markup = renderToStaticMarkup(
    createElement(ProjectBaseTimingPicker, {
      disabled: false,
      options: [
        {
          label: "Archive UCS · charts/hard.ucs",
          ref: {
            source: "archive_entry",
            archive_id: ArchiveIdSchema.parse("00000000-0000-4000-8000-000000000001"),
            archive_sha256: "0".repeat(64),
            entry_name: "charts/hard.ucs",
          },
        },
        {
          label: "Stored chart · Expert",
          ref: {
            source: "saved_chart",
            chart_id: ChartIdSchema.parse("00000000-0000-4000-8000-000000000002"),
          },
        },
        {
          label: "Original archive timing",
          ref: {
            source: "retained_timing",
            song_id: SongIdSchema.parse("00000000-0000-4000-8000-000000000003"),
          },
        },
      ],
      selected: null,
      onSelect: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Base timing source")
  expect(markup).toContain("Choose exact base timing")
  expect(markup).toContain("Archive UCS · charts/hard.ucs")
  expect(markup).toContain("Stored chart · Expert")
  expect(markup).toContain("Original archive timing")
  expect(markup).toContain('value="retained:00000000-0000-4000-8000-000000000003"')
  expect(markup).toContain('required=""')
})
