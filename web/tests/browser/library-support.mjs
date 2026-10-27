import assert from "node:assert/strict"

import { LibraryMutationSchema, LibrarySnapshotSchema } from "../../shared/library.ts"

export async function librarySnapshot(context, url) {
  const response = await context.request.get(new URL("/api/v1/library", url).toString())
  assert.equal(response.status(), 200)
  return LibrarySnapshotSchema.parse(await response.json())
}

export async function libraryMutation(page, path, action, method = "POST") {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === method,
  )
  await action()
  const response = await pending
  assert.equal(response.status(), 200, await response.text())
  return LibraryMutationSchema.parse(await response.json())
}

export function songSection(page) {
  return page.getByRole("region", { name: "Songs and charts", exact: true })
}

export function savedChartRow(page, name) {
  return page.locator(".library-chart-row").filter({ has: page.getByText(name, { exact: true }) })
}

export async function openLibrary(page) {
  await page.getByRole("button", { name: "Songs and charts", exact: true }).click()
  await page.getByRole("region", { name: "Create song", exact: true }).waitFor()
}

export async function closeLibrary(page) {
  await page
    .getByRole("dialog", { name: "Songs and charts", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click()
}

export async function chooseSong(page, title) {
  await page
    .getByRole("list", { name: "Saved songs", exact: true })
    .getByRole("button")
    .filter({ hasText: title })
    .click()
}
