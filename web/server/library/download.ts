import ky from "ky"

import { StudioError } from "../errors.ts"

const MAX_BYTES = 64 * 1024 * 1024
let active = 0

export type DownloadedUcsPackage = {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly name: string
  readonly source_url: string
  readonly title: string
  readonly artist: string
}

export function ucsPackageUrl(input: string): URL {
  const code = input.trim().toUpperCase()
  if (!/^CS[0-9]{3,4}$/.test(code))
    throw new StudioError(400, "download_code", "Enter a UCS song code such as CS839")
  return new URL(`/downloads/ucs/${code.toLowerCase()}.zip`, "https://www.pumpproplus.com")
}

export async function downloadUcsPackage(
  input: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DownloadedUcsPackage> {
  const url = ucsPackageUrl(input)
  if (active >= 2)
    throw new StudioError(
      429,
      "download_busy",
      "Two song downloads are already running; try again shortly",
    )
  active += 1
  try {
    const deadline = AbortSignal.timeout(30_000)
    const response = await ky.get(url, {
      fetch: fetcher,
      headers: {
        accept:
          "application/zip, application/x-zip-compressed, application/octet-stream, */*;q=0.5",
      },
      credentials: "omit",
      redirect: "error",
      retry: 0,
      throwHttpErrors: false,
      timeout: false,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new StudioError(
        502,
        "download_unavailable",
        `The public package source returned HTTP ${response.status}; no song was installed`,
      )
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
      await response.body?.cancel()
      throw new StudioError(413, "download_size", "Song ZIP exceeds the 64 MiB download limit")
    }
    const reader = response.body?.getReader()
    if (reader === undefined)
      throw new StudioError(502, "download_empty", "The package source returned no download data")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BYTES) {
          await reader.cancel()
          throw new StudioError(413, "download_size", "Song ZIP exceeds the 64 MiB download limit")
        }
        chunks.push(chunk.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
      throw new StudioError(
        502,
        "download_not_zip",
        "The source did not return a song ZIP; it may be unavailable or require visiting the source site",
      )
    const code = input.trim().toUpperCase()
    return {
      bytes,
      name: `${code.toLowerCase()}.zip`,
      source_url: url.toString(),
      title: code === "CS839" ? "Nemonemo" : code,
      artist: code === "CS839" ? "Yena" : "UCS base package",
    }
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw new StudioError(
      502,
      "download_failed",
      "Song download failed, was cancelled, or exceeded 30 seconds; no song was installed",
    )
  } finally {
    active -= 1
  }
}
