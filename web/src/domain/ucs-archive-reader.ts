import { type UnzipDecoder, UnzipPassThrough } from "fflate"

import { updateArchiveCrc } from "./archive-crc.ts"
import {
  MAX_AUDIO_BYTES,
  MAX_CHART_BYTES,
  MAX_SONG_BYTES,
  MAX_ZIP_BYTES,
  type UcsArchive,
  type UcsArchiveEntry,
  UcsArchiveError,
} from "./archive-policy.ts"
import { zipManifest } from "./zip-manifest.ts"

export type UcsArchiveDecoder = (name: string, compressedSize: number) => UnzipDecoder

export async function readUcsZipWithDecoder(
  file: File,
  createDecoder: UcsArchiveDecoder,
  signal?: AbortSignal,
): Promise<UcsArchive> {
  if (file.size > MAX_ZIP_BYTES)
    throw new UcsArchiveError("archive_input_limit", "ZIP must not exceed 64 MiB")
  signal?.throwIfAborted()
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal?.throwIfAborted()
  const manifest = zipManifest(bytes)
  return new Promise<UcsArchive>((resolve, reject) => {
    const active = new Set<UnzipDecoder>()
    const finished = new Map<string, UcsArchiveEntry>()
    let settled = false
    let fed = false
    let total = 0
    const cleanup = () => signal?.removeEventListener("abort", abort)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      for (const entry of active) entry.terminate?.()
      active.clear()
      cleanup()
      reject(
        error instanceof UcsArchiveError ||
          (error instanceof DOMException && error.name === "AbortError")
          ? error
          : new UcsArchiveError(
              "archive_invalid",
              "ZIP is corrupted, incomplete, or uses unsupported compression",
            ),
      )
    }
    const abort = () => fail(new DOMException("ZIP reading cancelled", "AbortError"))
    const complete = () => {
      if (settled || !fed || finished.size !== manifest.size) return
      settled = true
      cleanup()
      const charts: UcsArchiveEntry[] = []
      const audio: UcsArchiveEntry[] = []
      for (const [name, specification] of manifest) {
        const entry = finished.get(name)
        if (entry !== undefined) (specification.kind === "chart" ? charts : audio).push(entry)
      }
      resolve({ charts, audio })
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      for (const [name, specification] of manifest) {
        if (settled) break
        const entry =
          specification.compression === 0
            ? new UnzipPassThrough()
            : createDecoder(name, specification.compressedSize)
        const maximum = specification.kind === "chart" ? MAX_CHART_BYTES : MAX_AUDIO_BYTES
        const chunks: Uint8Array[] = []
        let size = 0
        let crc = 0xffffffff
        active.add(entry)
        entry.ondata = (error, chunk, final) => {
          if (settled) return
          if (error !== null) {
            fail(error)
            return
          }
          size += chunk.byteLength
          total += chunk.byteLength
          if (size > maximum || total > MAX_SONG_BYTES || size > specification.originalSize) {
            fail(
              new UcsArchiveError(
                "archive_output_limit",
                "ZIP decompressed data exceeds the song size limits",
              ),
            )
            return
          }
          crc = updateArchiveCrc(crc, chunk)
          chunks.push(chunk)
          if (!final) return
          active.delete(entry)
          if (
            size !== specification.originalSize ||
            (crc ^ 0xffffffff) >>> 0 !== specification.crc
          ) {
            fail(
              new UcsArchiveError(
                "archive_invalid",
                "ZIP chart or audio failed its size/checksum check",
              ),
            )
            return
          }
          const data = new Uint8Array(size)
          let offset = 0
          for (const part of chunks) {
            data.set(part, offset)
            offset += part.byteLength
          }
          finished.set(name, { name, data })
          complete()
        }
        if (specification.compressedSize === 0) entry.push(new Uint8Array(0), true)
        for (
          let offset = specification.dataStart;
          offset < specification.dataEnd && !settled;
          offset += 4_096
        )
          entry.push(
            bytes.subarray(offset, Math.min(offset + 4_096, specification.dataEnd)),
            offset + 4_096 >= specification.dataEnd,
          )
      }
      fed = true
      complete()
    } catch (error) {
      fail(error)
    }
  })
}
