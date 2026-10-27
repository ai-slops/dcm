import { strFromU8 } from "fflate"

import {
  archivePath,
  MAX_ARCHIVE_ENTRIES,
  MAX_AUDIO_BYTES,
  MAX_CHART_BYTES,
  MAX_SONG_BYTES,
  MAX_SONG_ENTRIES,
  songEntryKind,
  UcsArchiveError,
} from "./archive-policy.ts"

export type ZipSongEntry = {
  readonly name: string
  readonly originalSize: number
  readonly compressedSize: number
  readonly compression: number
  readonly crc: number
  readonly kind: "chart" | "audio"
  readonly localOffset: number
  readonly dataStart: number
  readonly dataEnd: number
}

function invalid(): never {
  throw new UcsArchiveError(
    "archive_invalid",
    "Use a complete, single-volume ZIP archive (ZIP64 is not supported)",
  )
}

export function zipManifest(bytes: Uint8Array): ReadonlyMap<string, ZipSongEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65_557)) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break
    end -= 1
  }
  if (end < 0 || end < bytes.length - 65_557) invalid()
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directory = view.getUint32(end + 16, true)
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count ||
    directory + directorySize !== end ||
    count === 0xffff
  )
    invalid()
  if (count > MAX_ARCHIVE_ENTRIES)
    throw new UcsArchiveError("archive_entry_limit", "ZIP contains too many entries (maximum 128)")
  const entries = new Map<string, ZipSongEntry>()
  const names = new Set<string>()
  const ranges: { readonly start: number; readonly end: number }[] = []
  let cursor = directory
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) invalid()
    const flags = view.getUint16(cursor + 8, true)
    const compression = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const originalSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const local = view.getUint32(cursor + 42, true)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (
      next > end ||
      local + 30 > directory ||
      view.getUint32(local, true) !== 0x04034b50 ||
      originalSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      view.getUint16(cursor + 34, true) !== 0
    )
      invalid()
    if ((flags & 0x41) !== 0 || (view.getUint16(local + 6, true) & 0x41) !== 0)
      throw new UcsArchiveError("archive_encrypted", "Encrypted ZIP entries are not supported")
    if (view.getUint16(local + 8, true) !== compression) invalid()
    const localFlags = view.getUint16(local + 6, true)
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const dataEnd = dataStart + compressedSize
    let recordEnd = dataEnd
    if (dataEnd > directory) invalid()
    if ((localFlags & 8) === 0) {
      if (
        view.getUint32(local + 18, true) !== compressedSize ||
        view.getUint32(local + 22, true) !== originalSize ||
        view.getUint32(local + 14, true) !== crc
      )
        invalid()
    } else {
      if (dataEnd + 12 > directory) invalid()
      const descriptor = view.getUint32(dataEnd, true) === 0x08074b50 ? dataEnd + 4 : dataEnd
      recordEnd = descriptor + 12
      if (
        descriptor + 12 > directory ||
        view.getUint32(descriptor, true) !== crc ||
        view.getUint32(descriptor + 4, true) !== compressedSize ||
        view.getUint32(descriptor + 8, true) !== originalSize
      )
        invalid()
    }
    const name = archivePath(
      strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x800) === 0),
    )
    const localName = archivePath(
      strFromU8(
        bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)),
        (localFlags & 0x800) === 0,
      ),
    )
    if (localName !== name) invalid()
    ranges.push({ start: local, end: recordEnd })
    const key = name.toLowerCase()
    if (names.has(key))
      throw new UcsArchiveError(
        "archive_duplicate",
        "ZIP contains duplicate or ambiguous filenames",
      )
    names.add(key)
    const kind = songEntryKind(name)
    if (kind !== null) {
      if (compression !== 0 && compression !== 8)
        throw new UcsArchiveError(
          "archive_compression",
          "Use stored or DEFLATE-compressed ZIP entries",
        )
      const maximum = kind === "chart" ? MAX_CHART_BYTES : MAX_AUDIO_BYTES
      total += originalSize
      if (originalSize > maximum || total > MAX_SONG_BYTES)
        throw new UcsArchiveError(
          "archive_output_limit",
          "ZIP exceeds chart (16 MiB), audio (32 MiB), or combined song (48 MiB) limits",
        )
      entries.set(name, {
        name,
        originalSize,
        compressedSize,
        compression,
        crc,
        kind,
        localOffset: local,
        dataStart,
        dataEnd,
      })
      if (entries.size > MAX_SONG_ENTRIES)
        throw new UcsArchiveError(
          "archive_entry_limit",
          "ZIP contains too many chart/music files (maximum 32)",
        )
    }
    cursor = next
  }
  if (cursor !== end) invalid()
  ranges.sort((left, right) => left.start - right.start)
  let previousEnd = 0
  for (const range of ranges) {
    if (range.start < previousEnd) invalid()
    previousEnd = range.end
  }
  if (![...entries.values()].some((entry) => entry.kind === "chart"))
    throw new UcsArchiveError("archive_missing_chart", "ZIP does not contain a UCS chart")
  if (![...entries.values()].some((entry) => entry.kind === "audio"))
    throw new UcsArchiveError(
      "archive_missing_audio",
      "ZIP does not contain WAV, OGG, or MP3 music; choose the matching song ZIP",
    )
  return entries
}
