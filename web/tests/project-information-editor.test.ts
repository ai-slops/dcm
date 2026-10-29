import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { ProjectInformationEditor } from "../src/ui/ProjectInformationEditor.tsx"

it("renders distinct song/chart artist, offset, duration, and split controls", () => {
  // Given / When
  const markup = renderToStaticMarkup(
    createElement(ProjectInformationEditor, {
      automaticExtent: { numerator: 7, denominator: 4 },
      chartArtist: "Stepper",
      disabled: false,
      notes: [],
      songArtist: "Song artist",
      timing: {
        schema_version: 1,
        offset_micros: -125_000,
        tempo: [
          {
            at: { numerator: 0, denominator: 1 },
            micros_per_beat: { numerator: 500_000, denominator: 1 },
          },
        ],
        grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 192 }],
        duration: null,
        reference_accents: [],
      },
      onChange: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Song artist")
  expect(markup).toContain("Chart artist")
  expect(markup).toContain("Audio offset (microseconds)")
  expect(markup).toContain("Duration policy")
  expect(markup).toContain("Automatic · content ends at beat 7/4")
  expect(markup).toContain("Split section start beat")
  expect(markup).toContain("Split (rows per four-beat measure)")
})
