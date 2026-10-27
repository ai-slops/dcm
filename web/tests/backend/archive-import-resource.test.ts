import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { zipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"

import { createStudioApp } from "../../server/app.ts"
import { loadConfig } from "../../server/config.ts"
import { BootstrapSchema } from "../../shared/index.ts"
import { LibraryMutationSchema } from "../../shared/library.ts"
import { repoRoot } from "../support/paths.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("archive import resource guards", () => {
  it("rejects a stale import before reading its persisted ZIP", async () => {
    // Given
    const client = await archiveClient()
    const staged = await stageArchive(client, ["chart.ucs"])
    const archive = staged.library.archives[0]
    const song = staged.library.songs[0]
    if (archive === undefined || song === undefined) return
    await client.json("/api/v1/library/actions", {
      type: "rename_song",
      library_revision: staged.library.revision,
      song_id: song.id,
      title: song.title,
      artist: song.artist,
    })
    await writeFile(join(client.root, "archives", `${archive.sha256}.zip`), Uint8Array.of(0))

    // When
    const response = await client.json("/api/v1/library/actions", {
      type: "import_archive",
      library_revision: staged.library.revision,
      archive_id: archive.id,
      audio_name: "music.wav",
      chart_names: ["chart.ucs"],
      title: "Imported",
      artist: "Artist",
    })

    // Then
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "library_revision_conflict" } })
  })

  it("stops chart fanout on the first native import failure", async () => {
    // Given
    const client = await archiveClient()
    const staged = await stageArchive(client, ["one.ucs", "two.ucs"])
    const archive = staged.library.archives[0]
    if (archive === undefined) return
    let calls = 0
    Object.defineProperty(client.studio.archives, "ucs", {
      value: {
        import: async () => {
          calls += 1
          throw new Error("fixture import failure")
        },
      },
    })

    // When
    const response = await client.json("/api/v1/library/actions", {
      type: "import_archive",
      library_revision: staged.library.revision,
      archive_id: archive.id,
      audio_name: "music.wav",
      chart_names: ["one.ucs", "two.ucs"],
      title: "Imported",
      artist: "Artist",
    })

    // Then
    expect(response.status).toBe(500)
    expect(calls).toBe(1)
  })
})

async function archiveClient() {
  const root = await mkdtemp(join(tmpdir(), "pump-archive-resource-"))
  roots.push(root)
  const studio = await createStudioApp(
    loadConfig({ STUDIO_DATA: root, STUDIO_REPO_ROOT: repoRoot }),
  )
  const bootstrapResponse = await studio.app.request("http://127.0.0.1:4173/api/v1/bootstrap")
  const bootstrap = BootstrapSchema.parse(await bootstrapResponse.json())
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set("cookie", cookie)
    if (init.method !== undefined && init.method !== "GET")
      headers.set("x-csrf-token", bootstrap.csrf_token)
    return studio.app.request(`http://127.0.0.1:4173${path}`, { ...init, headers })
  }
  return {
    root,
    studio,
    request,
    json: (path: string, body: unknown) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}

async function stageArchive(
  client: Awaited<ReturnType<typeof archiveClient>>,
  chartNames: readonly string[],
) {
  const files = Object.fromEntries(chartNames.map((name) => [name, Uint8Array.of(1)]))
  const archiveBytes = zipSync({ ...files, "music.wav": Uint8Array.of(1) })
  const form = new FormData()
  form.set("library_revision", "0")
  form.set("file", new File([archiveBytes], "song.zip", { type: "application/zip" }))
  return LibraryMutationSchema.parse(
    await (await client.request("/api/v1/library/archives", { method: "POST", body: form })).json(),
  )
}
