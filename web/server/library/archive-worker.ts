import { parentPort } from "node:worker_threads"

import { UnzipInflate } from "fflate"

import { UcsArchiveError } from "../../src/domain/archive-policy.ts"
import { readUcsZipWithDecoder } from "../../src/domain/ucs-archive-reader.ts"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "./archive-worker-protocol.ts"

const port = parentPort
if (port === null) throw new TypeError("Archive worker requires a parent port")

port.on("message", async (request: ArchiveWorkerRequest) => {
  let response: ArchiveWorkerResponse
  try {
    const archive = await readUcsZipWithDecoder(
      new File([request.bytes], request.name, { type: "application/zip" }),
      () => new UnzipInflate(),
    )
    response = { ok: true, archive }
  } catch (error) {
    response =
      error instanceof UcsArchiveError
        ? { ok: false, code: error.code, message: error.message }
        : {
            ok: false,
            code: "archive_invalid",
            message: "ZIP is corrupted, incomplete, or uses unsupported compression",
          }
  }
  const transfers = response.ok
    ? [...response.archive.charts, ...response.archive.audio].map((entry) => entry.data.buffer)
    : []
  port.postMessage(response, transfers)
})
