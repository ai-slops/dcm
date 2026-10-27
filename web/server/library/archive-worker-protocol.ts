import type { UcsArchive } from "../../src/domain/archive-policy.ts"

export type ArchiveWorkerRequest = {
  readonly bytes: ArrayBuffer
  readonly name: string
}

export type ArchiveWorkerResponse =
  | { readonly ok: true; readonly archive: UcsArchive }
  | { readonly ok: false; readonly code: string; readonly message: string }
