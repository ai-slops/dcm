import { spawn } from "node:child_process"

import { z } from "zod"

import { StudioError } from "../errors.ts"

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAXIMUM_QUEUE = 32
const NativeRejectionSchema = z.object({ ok: z.literal(false), error: z.string().max(4096) })

type Waiter = {
  readonly resolve: () => void
  readonly signal: AbortSignal | undefined
  readonly cancel: () => void
}

export class ProcessPool {
  #active = 0
  readonly #waiting: Waiter[] = []

  constructor(
    readonly maximum: number,
    readonly maximumQueue = DEFAULT_MAXIMUM_QUEUE,
    readonly reportUcsErrors = false,
  ) {}

  async run(executable: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
    await this.#acquire(signal)
    try {
      return await runProcess(executable, args, { signal, reportUcsErrors: this.reportUcsErrors })
    } finally {
      this.#release()
    }
  }

  async #acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw cancelled()
    if (this.#active < this.maximum) {
      this.#active += 1
      return
    }
    if (this.#waiting.length >= this.maximumQueue) {
      throw new StudioError(429, "native_queue_full", "Native operation queue is full")
    }
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        const index = this.#waiting.indexOf(waiter)
        if (index >= 0) this.#waiting.splice(index, 1)
        reject(cancelled())
      }
      const waiter: Waiter = { resolve, signal, cancel }
      this.#waiting.push(waiter)
      signal?.addEventListener("abort", cancel, { once: true })
    })
  }

  #release(): void {
    this.#active -= 1
    const waiter = this.#waiting.shift()
    if (waiter === undefined) return
    waiter.signal?.removeEventListener("abort", waiter.cancel)
    this.#active += 1
    waiter.resolve()
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: { readonly signal: AbortSignal | undefined; readonly reportUcsErrors: boolean },
): Promise<string> {
  const { signal } = options
  if (signal?.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const output: Buffer[] = []
    const diagnostics: Buffer[] = []
    let diagnosticBytes = 0
    let outputBytes = 0
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 60_000)
    const cancel = () => child.kill("SIGKILL")
    signal?.addEventListener("abort", cancel, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL")
      else output.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL")
      if (diagnosticBytes < 4096) {
        const retained = chunk.subarray(0, 4096 - diagnosticBytes)
        diagnostics.push(retained)
        diagnosticBytes += retained.byteLength
      }
    })
    child.on("error", () => {
      if (signal?.aborted) finish(cancelled())
      else finish(new StudioError(503, "native_unavailable", "Native runtime is unavailable"))
    })
    child.on("close", (code) => {
      if (signal?.aborted) finish(cancelled())
      else if (timedOut)
        finish(new StudioError(504, "native_timeout", "Native operation timed out"))
      else if (outputBytes > MAX_OUTPUT_BYTES)
        finish(new StudioError(500, "native_output_limit", "Native output exceeded its limit"))
      else if (code !== 0)
        finish(nativeFailure(Buffer.concat(diagnostics).toString("utf8"), options.reportUcsErrors))
      else finish(undefined, Buffer.concat(output).toString("utf8"))
    })

    function finish(error?: StudioError, value?: string): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      if (error === undefined) resolve(value ?? "")
      else reject(error)
    }
  })
}

function nativeFailure(diagnostic: string, reportUcsErrors: boolean): StudioError {
  if (diagnostic !== "") {
    try {
      const parsed = NativeRejectionSchema.safeParse(JSON.parse(diagnostic))
      if (parsed.success && parsed.data.error.includes("fraction arithmetic overflow")) {
        return new StudioError(
          422,
          "timing_capacity_exceeded",
          "Exact native timing exceeded its rational arithmetic capacity. The chart and its tempo map are unchanged.",
        )
      }
      if (reportUcsErrors && parsed.success && parsed.data.error.startsWith("UCS ")) {
        return new StudioError(422, "ucs_rejected", parsed.data.error.slice(0, 1024))
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return new StudioError(422, "native_failed", "Native operation rejected the input")
}

function cancelled(): StudioError {
  return new StudioError(409, "cancelled", "Operation was cancelled")
}
