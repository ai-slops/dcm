import assert from "node:assert/strict"

import { ownedMutation } from "./ucs-support.mjs"

export async function saveExportMode(page, mode) {
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByRole("radio", { name: mode, exact: true }).check()
  assert.equal(
    await page.getByRole("button", { name: "Download UCS", exact: true }).isDisabled(),
    true,
  )
  await page.getByRole("button", { name: "Close", exact: true }).click()
  return ownedMutation(page, "/api/v1/document", () =>
    page.getByRole("button", { name: "Save", exact: true }).click(),
  )
}
