import { Worker } from "node:worker_threads"

import { type UcsArchive, UcsArchiveError } from "../../src/domain/archive-policy.ts"
import { StudioError } from "../errors.ts"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "./archive-worker-protocol.ts"

type ArchiveJob = {
  readonly bytes: Uint8Array
  readonly name: string
  readonly resolve: (archive: UcsArchive) => void
  readonly reject: (error: Error) => void
}

const concurrency = 1
const queued: ArchiveJob[] = []
let active = 0

export function parseArchiveInWorker(bytes: Uint8Array, name: string): Promise<UcsArchive> {
  if (queued.length >= 2)
    return Promise.reject(
      new StudioError(503, "archive_busy", "Archive processing is busy; try again"),
    )
  return new Promise((resolve, reject) => {
    queued.push({ bytes, name, resolve, reject })
    drain()
  })
}

export function archiveResourceUsage(): { readonly active: number; readonly queued: number } {
  return { active, queued: queued.length }
}

function drain(): void {
  while (active < concurrency) {
    const job = queued.shift()
    if (job === undefined) return
    active += 1
    run(job)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1
        drain()
      })
  }
}

function run(job: ArchiveJob): Promise<UcsArchive> {
  const source = Uint8Array.from(job.bytes)
  const request: ArchiveWorkerRequest = { bytes: source.buffer, name: job.name }
  const sourceMode = import.meta.url.endsWith(".ts")
  const workerName = sourceMode ? "archive-worker.ts" : "archive-worker.js"
  const worker = new Worker(new URL(workerName, import.meta.url), {
    ...(sourceMode ? { execArgv: ["--experimental-transform-types"] } : {}),
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(error)
    }
    worker.once("error", fail)
    worker.once("exit", (code) => {
      if (code !== 0) fail(new Error(`Archive worker exited with code ${code}`))
    })
    worker.once("message", (response: ArchiveWorkerResponse) => {
      if (settled) return
      settled = true
      void worker.terminate()
      if (response.ok) resolve(response.archive)
      else reject(new UcsArchiveError(response.code, response.message))
    })
    worker.postMessage(request, [request.bytes])
  })
}
