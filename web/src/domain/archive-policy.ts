export const MAX_ZIP_BYTES = 64 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 128
export const MAX_SONG_ENTRIES = 32
export const MAX_CHART_BYTES = 16 * 1024 * 1024
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024
export const MAX_SONG_BYTES = 48 * 1024 * 1024

export class UcsArchiveError extends Error {
  override readonly name = "UcsArchiveError"
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type UcsArchiveEntry = {
  readonly name: string
  readonly data: Uint8Array<ArrayBuffer>
}

export type UcsArchive = {
  readonly charts: readonly UcsArchiveEntry[]
  readonly audio: readonly UcsArchiveEntry[]
}

export function archivePath(name: string): string {
  const path = name.replaceAll("\\", "/")
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.includes(":") ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    throw new UcsArchiveError("archive_path", "ZIP contains an unsafe or excessively long filename")
  return path
}

export function songEntryKind(name: string): "chart" | "audio" | null {
  if (name.startsWith("__MACOSX/") || name.split("/").at(-1)?.startsWith("._")) return null
  if (/\.ucs$/i.test(name)) return "chart"
  if (/\.(wav|ogg|mp3)$/i.test(name)) return "audio"
  return null
}
