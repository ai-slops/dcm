import ky from "ky"

import type { UcsCatalogResult } from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import { catalogForm, catalogResult } from "./catalog-html.ts"

const SOURCE = "https://www.pumpproplus.com/ucs-base-list.aspx"
let active = 0

async function readHtml(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new StudioError(
      502,
      "catalog_unavailable",
      `The public song catalog returned HTTP ${response.status}`,
    )
  }
  const reader = response.body?.getReader()
  if (reader === undefined)
    throw new StudioError(502, "catalog_invalid", "The public song catalog returned no data")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1024 * 1024) {
        await reader.cancel()
        throw new StudioError(
          502,
          "catalog_limit",
          "The public song catalog response exceeded 1 MiB",
        )
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

export async function searchUcsCatalog(
  queryInput: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<UcsCatalogResult> {
  const query = queryInput.trim()
  if (
    query.length === 0 ||
    query.length > 100 ||
    [...query].some((character) => character.charCodeAt(0) < 32)
  )
    throw new StudioError(
      400,
      "catalog_query",
      "Enter a song title, artist, or UCS code (maximum 100 characters)",
    )
  if (active >= 2)
    throw new StudioError(
      429,
      "catalog_busy",
      "Two catalog searches are already running; try again shortly",
    )
  active += 1
  try {
    const deadline = AbortSignal.timeout(20_000)
    const options = {
      fetch: fetcher,
      credentials: "omit",
      redirect: "error",
      retry: 0,
      throwHttpErrors: false,
      timeout: false,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    } as const
    const page = await ky.get(SOURCE, { ...options, headers: { accept: "text/html, */*;q=0.5" } })
    const cookies = page.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .filter(Boolean)
      .join("; ")
    const form = catalogForm(await readHtml(page), query)
    const result = await ky.post(SOURCE, {
      ...options,
      headers: { accept: "text/html, */*;q=0.5", ...(cookies === "" ? {} : { cookie: cookies }) },
      body: form,
    })
    return catalogResult(await readHtml(result), query)
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw new StudioError(
      502,
      "catalog_failed",
      "Song catalog search failed, was cancelled, or exceeded 20 seconds; downloading by UCS code is still available",
    )
  } finally {
    active -= 1
  }
}
