import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import { type BundleRequest, resolveBundle } from "../../server/native/bundle-cache.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("native bundle cache", () => {
  it("single-flights compilation for one fingerprint", async () => {
    // Given
    const release = deferred<void>()
    let compilations = 0
    const request = await fixture(async ({ bundle }) => {
      compilations += 1
      await release.promise
      await mkdir(bundle)
      await writeFile(join(bundle, "artifact"), "complete")
    })

    // When
    const first = resolveBundle(request)
    const second = resolveBundle(request)
    release.resolve()

    // Then
    const firstPath = await first
    expect(await second).toBe(firstPath)
    expect(compilations).toBe(1)
  })

  it("removes a partial bundle after compilation fails", async () => {
    // Given
    let partial = ""
    const request = await fixture(async ({ bundle }) => {
      partial = bundle
      await mkdir(bundle)
      await writeFile(join(bundle, "partial"), "broken")
      throw new TypeError("compile failed")
    })

    // When
    const result = resolveBundle(request)

    // Then
    await expect(result).rejects.toThrow("compile failed")
    await expect(stat(partial)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each(["cli", "author", "runtime"] as const)(
    "uses the exact %s compiler artifact in the cache identity",
    async (artifact) => {
      // Given
      let compilations = 0
      const request = await fixture(async ({ bundle }) => {
        compilations += 1
        await mkdir(bundle)
        await writeFile(join(bundle, "artifact"), "complete")
      })

      // When
      const first = await resolveBundle(request)
      const changed = await resolveBundle({
        ...request,
        compilerArtifacts: {
          ...request.compilerArtifacts,
          [artifact]: new Uint8Array([9]),
        },
      })

      // Then
      expect(changed).not.toBe(first)
      expect(compilations).toBe(2)
    },
  )

  it("rebuilds an interrupted cache directory instead of trusting its existence", async () => {
    // Given
    let compilations = 0
    const request = await fixture(async ({ bundle }) => {
      compilations += 1
      await mkdir(bundle)
      await writeFile(join(bundle, "artifact"), `complete-${compilations}`)
    })
    const bundle = await resolveBundle(request)
    await rm(bundle, { recursive: true })
    await mkdir(bundle)
    await writeFile(join(bundle, "partial"), "broken")

    // When
    const rebuilt = await resolveBundle(request)

    // Then
    expect(rebuilt).toBe(bundle)
    expect(compilations).toBe(2)
    await expect(stat(join(bundle, "artifact"))).resolves.toBeDefined()
  })
})

type TestBundleRequest = BundleRequest & {
  readonly compilerArtifacts: {
    readonly cli: Uint8Array
    readonly author: Uint8Array
    readonly runtime: Uint8Array
  }
}

async function fixture(compile: BundleRequest["compile"]): Promise<TestBundleRequest> {
  const root = await mkdtemp(join(tmpdir(), "pump-studio-bundle-"))
  roots.push(root)
  const demo = await loadDemo(repoRoot)
  return {
    root,
    flights: new Map(),
    project: demo.document.project,
    audio: {
      bytes: demo.audio,
      digest: demo.document.project.music.audio_sha256
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      format: "wav",
    },
    signal: undefined,
    compilerArtifacts: {
      cli: new Uint8Array([1]),
      author: new Uint8Array([2]),
      runtime: new Uint8Array([3]),
    },
    compile,
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
