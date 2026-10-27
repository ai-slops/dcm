import { AsyncUnzipInflate } from "fflate"

import type { UcsArchive } from "./archive-policy.ts"
import { readUcsZipWithDecoder } from "./ucs-archive-reader.ts"

export type { UcsArchive, UcsArchiveEntry } from "./archive-policy.ts"

export async function readUcsZip(file: File, signal?: AbortSignal): Promise<UcsArchive> {
  return readUcsZipWithDecoder(
    file,
    (name, compressedSize) => new AsyncUnzipInflate(name, compressedSize),
    signal,
  )
}
