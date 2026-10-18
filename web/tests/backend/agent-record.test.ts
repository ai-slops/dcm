import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ok } from "@slop-lab/part/contracts/index.js"
import { afterEach, describe, expect, it } from "vitest"
import type { PartRun, PartRuntimeFactory } from "../../server/agent/part-runtime.ts"
import { AgentRuns, type NativeOperations } from "../../server/agent/runs.ts"
import { loadDemo } from "../../server/demo.ts"
import { SessionStore } from "../../server/sessions.ts"
import { StudioStore } from "../../server/store.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("RunRecord lifecycle", () => {
  it("turns a thrown start into one redacted failure and disposes exactly once", async () => {
    // Given
    const harness = await createHarness()
    let disposals = 0
    const runs = harness.runs(() =>
      ok({
        start: () => Promise.reject(new Error("provider-secret")),
        dispose: async () => {
          disposals += 1
        },
      }),
    )

    // When
    const started = runs.start(harness.session, harness.store.document(), "Inspect")
    const record = runs.get(harness.session, started.id)
    await record.settled()

    // Then
    expect(record.snapshot.status).toBe("failed")
    expect(disposals).toBe(1)
    expect(JSON.stringify(record.events)).not.toContain("provider-secret")
  })

  it("cancels and disposes a handle acquired after cancellation without clearing a newer run", async () => {
    // Given
    const harness = await createHarness()
    const firstStart = deferred<ReturnType<typeof ok<PartRun>>>()
    const secondDone = deferred<Awaited<PartRun["done"]>>()
    let creations = 0
    let firstCancellations = 0
    let firstDisposals = 0
    const runs = harness.runs(() => {
      creations += 1
      if (creations === 1) {
        return ok({
          start: () => firstStart.promise,
          dispose: async () => {
            firstDisposals += 1
          },
        })
      }
      return ok({
        start: async () => ok(partRun(secondDone.promise)),
        dispose: async () => undefined,
      })
    })
    const first = runs.start(harness.session, harness.store.document(), "First")
    const firstRecord = runs.get(harness.session, first.id)

    // When
    await firstRecord.cancel()
    const second = runs.start(harness.session, harness.store.document(), "Second")
    firstStart.resolve(
      ok(
        partRun(Promise.resolve({ phase: "cancelled" }), () => {
          firstCancellations += 1
        }),
      ),
    )
    await firstRecord.settled()

    // Then
    expect(firstCancellations).toBe(1)
    expect(firstDisposals).toBe(1)
    expect(harness.session.activeRunId).toBe(second.id)
    const secondRecord = runs.get(harness.session, second.id)
    await secondRecord.cancel()
    secondDone.resolve({ phase: "cancelled" })
    await secondRecord.settled()
  })

  it("uses the audio snapshot captured when the run starts", async () => {
    // Given
    let capturedDigest = ""
    const native: NativeOperations = {
      evaluate: async () => Promise.reject(new Error("not expected")),
      generate: async (_project, audio) => {
        capturedDigest = audio.digest
        return { ticks_per_beat: 4, span_ticks: 32, notes: [] }
      },
    }
    const harness = await createHarness(native)
    const originalDigest = harness.store.audio().digest
    const release = deferred<void>()
    const runs = harness.runs((options) =>
      ok({
        start: async () => {
          await release.promise
          await options.generateVariant("0".repeat(64), options.signal)
          return ok(partRun(Promise.resolve({ phase: "completed", text: "finished" })))
        },
        dispose: async () => undefined,
      }),
    )
    const started = runs.start(harness.session, harness.store.document(), "Generate")
    const record = runs.get(harness.session, started.id)
    const replacement = Uint8Array.from(harness.store.audio().bytes)
    replacement[replacement.length - 1] = (replacement.at(-1) ?? 0) ^ 1
    const digest = createHash("sha256").update(replacement).digest()
    const current = harness.store.document()
    await harness.store.replace(
      current.revision,
      { ...current.project, music: { ...current.project.music, audio_sha256: [...digest] } },
      replacement,
    )

    // When
    release.resolve()
    await record.settled()

    // Then
    expect(capturedDigest).toBe(originalDigest)
    expect(record.snapshot.status).toBe("completed")
  })

  it("bounds retained runs and events while preserving the active run", async () => {
    // Given
    const harness = await createHarness()
    const runs = harness.runs(() => {
      return ok({
        start: async () => ok(partRun(Promise.resolve({ phase: "completed", text: "finished" }))),
        dispose: async () => undefined,
      })
    })
    let firstId = ""

    // When
    for (let index = 0; index < 260; index += 1) {
      const started = runs.start(harness.session, harness.store.document(), `Run ${index}`)
      if (index === 0) firstId = started.id
      await runs.get(harness.session, started.id).settled()
    }

    // Then
    expect(harness.session.runs.size).toBe(32)
    expect(() => runs.get(harness.session, firstId)).toThrowError(/not found/i)
  })

  it("caps replayable event history at 512 records", async () => {
    // Given
    const harness = await createHarness()
    const runs = harness.runs(() =>
      ok({
        start: async () =>
          ok(partRun(Promise.resolve({ phase: "completed", text: "finished" }), undefined, 600)),
        dispose: async () => undefined,
      }),
    )

    // When
    const started = runs.start(harness.session, harness.store.document(), "Stream")
    const record = runs.get(harness.session, started.id)
    await record.settled()

    // Then
    expect(record.events).toHaveLength(512)
    expect(record.events[0]?.sequence).toBeGreaterThan(0)
    expect(record.snapshot.last_sequence).toBe(602)
  })
})

function partRun(
  done: PartRun["done"],
  cancel: (() => void) | undefined = undefined,
  updates = 0,
): PartRun {
  return {
    done,
    observe: () => deltas(updates),
    cancel: async () => cancel?.(),
  }
}

async function* deltas(count: number) {
  for (let index = 0; index < count; index += 1) yield { text: String(index) }
}

async function createHarness(native: NativeOperations = rejectingNative()) {
  const root = await mkdtemp(join(tmpdir(), "pump-studio-run-record-"))
  roots.push(root)
  const demo = await loadDemo(repoRoot)
  const store = await StudioStore.open(root, demo.document, demo.audio)
  const session = new SessionStore().create()
  return {
    store,
    session,
    runs: (createRuntime: PartRuntimeFactory) =>
      new AgentRuns({
        configuration: {
          endpoint: new URL("http://127.0.0.1:1/v1/chat/completions"),
          model: "test",
        },
        store,
        native,
        createRuntime,
      }),
  }
}

function rejectingNative(): NativeOperations {
  return {
    evaluate: async () => Promise.reject(new Error("not expected")),
    generate: async () => Promise.reject(new Error("not expected")),
  }
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (resolveValue === undefined) throw new TypeError("Deferred promise is not initialized")
      resolveValue(value)
    },
  }
}
