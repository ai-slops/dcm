import { build } from "esbuild"
import { zipSync } from "fflate"
import { expect, it } from "vitest"

import { parseArchiveInWorker } from "../../server/library/archive-resource.ts"
import { zipManifest } from "../../src/domain/zip-manifest.ts"

function incompressibleBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 1
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    bytes[index] = state >>> 24
  }
  return bytes
}

it("parses 32 incompressible worker-sized song entries inside one outer worker", async () => {
  // Given
  const entry = incompressibleBytes(1_000_000)
  const files = Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => [`chart-${index}.ucs`, entry]),
  )
  const bytes = zipSync({ ...files, "music.wav": entry })
  const manifest = zipManifest(bytes)
  expect([...manifest.values()].every((item) => item.compressedSize > 320_000)).toBe(true)

  // When
  const archive = await parseArchiveInWorker(bytes, "incompressible.zip")

  // Then
  expect(archive.charts).toHaveLength(31)
  expect(archive.audio).toHaveLength(1)
}, 60_000)

it("keeps asynchronous fflate decoders out of the compiled server worker", async () => {
  // Given
  const result = await build({
    bundle: true,
    entryPoints: ["server/library/archive-worker.ts"],
    format: "esm",
    packages: "external",
    platform: "node",
    target: "node24",
    write: false,
  })
  const output = result.outputFiles[0]
  if (output === undefined) throw new TypeError("Archive worker build output is missing")
  const source = output.text

  // Then
  expect(source).toContain("UnzipInflate")
  expect(source).not.toContain("AsyncUnzipInflate")
})
