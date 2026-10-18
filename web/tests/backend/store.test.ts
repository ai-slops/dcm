import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDemo } from "../../server/demo.ts"
import type { StudioError } from "../../server/errors.ts"
import { StudioStore } from "../../server/store.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("StudioStore durability", () => {
  it("rejects a persisted audio asset whose bytes do not match the document", async () => {
    // Given
    const { root, demo } = await fixture()
    await StudioStore.open(root, demo.document, demo.audio)
    const digest = createHash("sha256").update(demo.audio).digest("hex")
    const path = join(root, "audio", `${digest}.wav`)
    const corrupted = Uint8Array.from(await readFile(path))
    corrupted[corrupted.length - 1] = (corrupted.at(-1) ?? 0) ^ 1
    await writeFile(path, corrupted)

    // When
    const reopened = StudioStore.open(root, demo.document, demo.audio)

    // Then
    await expect(reopened).rejects.toMatchObject<Partial<StudioError>>({ code: "audio_corrupt" })
  })

  it("keeps the previous in-memory audio when document publication fails", async () => {
    // Given
    const { root, demo } = await fixture()
    const store = await StudioStore.open(root, demo.document, demo.audio)
    const previous = store.audio()
    const replacement = Uint8Array.from(demo.audio)
    replacement[replacement.length - 1] = (replacement.at(-1) ?? 0) ^ 1
    const digest = createHash("sha256").update(replacement).digest()
    const project = {
      ...demo.document.project,
      music: { ...demo.document.project.music, audio_sha256: [...digest] },
    }
    await unlink(join(root, "document.json"))
    await mkdir(join(root, "document.json"))

    // When
    const replaced = store.replace(demo.document.revision, project, replacement)

    // Then
    await expect(replaced).rejects.toBeInstanceOf(Error)
    expect(store.audio()).toEqual(previous)
    expect(store.document()).toEqual(demo.document)
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pump-studio-store-"))
  roots.push(root)
  return { root, demo: await loadDemo(repoRoot) }
}
