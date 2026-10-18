import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

import { z } from "zod"

import type { StudioProjectV1 } from "../../shared/index.ts"
import type { AudioRecord } from "../store.ts"

export type BundleRequest = {
  readonly root: string
  readonly flights: Map<string, Promise<string>>
  readonly project: StudioProjectV1
  readonly audio: AudioRecord
  readonly compilerArtifacts: {
    readonly cli: Uint8Array
    readonly author: Uint8Array
    readonly runtime: Uint8Array
  }
  readonly signal: AbortSignal | undefined
  readonly compile: (input: BundleCompileInput) => Promise<void>
}

const MANIFEST_SUFFIX = ".manifest.json"
const CacheManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    fingerprint: z.string().length(64),
    files: z
      .array(
        z
          .strictObject({
            path: z.string().min(1),
            sha256: z.string().length(64),
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly()

type CachedFile = z.infer<typeof CacheManifestSchema>["files"][number]

export type BundleCompileInput = {
  readonly bundle: string
  readonly project: StudioProjectV1
  readonly audio: AudioRecord
  readonly signal: AbortSignal | undefined
}

export async function resolveBundle(request: BundleRequest): Promise<string> {
  const hash = createHash("sha256")
  updateIdentity(hash, "music", JSON.stringify(request.project.music))
  updateIdentity(hash, "contract", JSON.stringify(request.project.evaluation_contract))
  updateIdentity(hash, "audio", request.audio.digest)
  updateIdentity(hash, "cli", request.compilerArtifacts.cli)
  updateIdentity(hash, "author", request.compilerArtifacts.author)
  updateIdentity(hash, "runtime", request.compilerArtifacts.runtime)
  const fingerprint = hash.digest("hex")
  const existing = request.flights.get(fingerprint)
  if (existing !== undefined) return existing
  const flight = compileMissing(request, fingerprint)
  request.flights.set(fingerprint, flight)
  try {
    return await flight
  } finally {
    if (request.flights.get(fingerprint) === flight) request.flights.delete(fingerprint)
  }
}

async function compileMissing(request: BundleRequest, fingerprint: string): Promise<string> {
  const bundle = resolve(request.root, `${fingerprint}.bundle`)
  await mkdir(request.root, { recursive: true })
  if (await isCompleteBundle(bundle, fingerprint)) return bundle
  await Promise.all([
    rm(bundle, { recursive: true, force: true }),
    rm(manifestPath(bundle), { force: true }),
  ])
  const staging = resolve(request.root, `${fingerprint}.staging-${randomUUID()}`)
  const stagingManifest = manifestPath(staging)
  try {
    await request.compile({
      bundle: staging,
      project: request.project,
      audio: request.audio,
      signal: request.signal,
    })
    const files = await bundleFiles(staging)
    const manifest = CacheManifestSchema.parse({ schema_version: 1, fingerprint, files })
    await writeFile(stagingManifest, JSON.stringify(manifest), { flag: "wx" })
    await rename(staging, bundle)
    await rename(stagingManifest, manifestPath(bundle))
    return bundle
  } catch (error) {
    await Promise.all([
      rm(staging, { recursive: true, force: true }),
      rm(stagingManifest, { force: true }),
      rm(bundle, { recursive: true, force: true }),
      rm(manifestPath(bundle), { force: true }),
    ])
    throw error
  }
}

function updateIdentity(
  hash: ReturnType<typeof createHash>,
  label: string,
  value: string | Uint8Array,
): void {
  hash.update(`${label}:${value.length}:`)
  hash.update(value)
}

async function isCompleteBundle(bundle: string, fingerprint: string): Promise<boolean> {
  try {
    const parsed = CacheManifestSchema.safeParse(
      JSON.parse(await readFile(manifestPath(bundle), "utf8")),
    )
    if (!parsed.success || parsed.data.fingerprint !== fingerprint) return false
    const files = await bundleFiles(bundle)
    return JSON.stringify(files) === JSON.stringify(parsed.data.files)
  } catch {
    return false
  }
}

async function bundleFiles(root: string, directory = root): Promise<readonly CachedFile[]> {
  const files: CachedFile[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await bundleFiles(root, path)))
    else if (entry.isFile()) {
      files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      })
    } else throw new TypeError("Bundle contains an unsupported filesystem entry")
  }
  return files
}

function manifestPath(bundle: string): string {
  return `${bundle}${MANIFEST_SUFFIX}`
}
