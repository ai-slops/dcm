import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import { BeatChartDocumentSchema } from "../../shared/index.ts"
import { bootstrap, SINGLE_UCS_FIXTURE } from "./ucs-support.mjs"

export const SINGLE_BROWSER_UCS_FIXTURE = [
  SINGLE_UCS_FIXTURE,
  ...Array.from({ length: 504 }, () => "....."),
].join("\r\n")

export function roundtripFixture(base, audio) {
  return BeatChartDocumentSchema.parse({
    ...base,
    title: "UCS browser regression",
    mode: "Double",
    timing: {
      schema_version: 1,
      offset_micros: 250_000,
      tempo: [
        {
          at: { numerator: 0, denominator: 1 },
          micros_per_beat: { numerator: 500_000, denominator: 1 },
        },
        {
          at: { numerator: 4, denominator: 1 },
          micros_per_beat: { numerator: 400_000, denominator: 1 },
        },
      ],
      grid_sections: [{ at: { numerator: 0, denominator: 1 }, rows_per_measure: 16 }],
      duration: { numerator: 48, denominator: 1 },
      reference_accents: [],
    },
    notes: [
      {
        at: { numerator: 0, denominator: 1 },
        hold: { numerator: 0, denominator: 1 },
        panel_mask: 544,
      },
      {
        at: { numerator: 0, denominator: 1 },
        hold: { numerator: 1, denominator: 1 },
        panel_mask: 1,
      },
      {
        at: { numerator: 3, denominator: 4 },
        hold: { numerator: 1, denominator: 2 },
        panel_mask: 16,
      },
      {
        at: { numerator: 2, denominator: 1 },
        hold: { numerator: 3, denominator: 1 },
        panel_mask: 2,
      },
      {
        at: { numerator: 4, denominator: 1 },
        hold: { numerator: 1, denominator: 1 },
        panel_mask: 4,
      },
      {
        at: { numerator: 6, denominator: 1 },
        hold: { numerator: 1, denominator: 1 },
        panel_mask: 8,
      },
      {
        at: { numerator: 14, denominator: 1 },
        hold: { numerator: 2, denominator: 1 },
        panel_mask: 16,
      },
    ],
    audio_sha256: createHash("sha256").update(audio).digest("hex"),
    audio_asset: { format: "wav", byte_length: audio.byteLength },
  })
}

export async function downloadBeatUcs(page, path, mode) {
  const state = await bootstrap(page.context(), page.url())
  assert.equal(state.document.project.mode, mode, "Export must use the chart's fixed mode")
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  assert.equal(await page.getByRole("radio", { name: mode, exact: true }).count(), 0)
  const pending = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download UCS", exact: true }).click()
  const download = await pending
  assert.equal(await download.failure(), null)
  await download.saveAs(path)
  await page.getByRole("button", { name: "Close", exact: true }).click()
}
