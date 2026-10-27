import { randomUUID } from "node:crypto"
import { link, open, readFile, rename, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { StudioError } from "../errors.ts"

export type AssetWrite = {
  readonly directory: "audio" | "archives"
  readonly digest: string
  readonly extension: string
  readonly bytes: Uint8Array
}

export function assetPath(root: string, asset: Omit<AssetWrite, "bytes">): string {
  return resolve(root, asset.directory, `${asset.digest}.${asset.extension}`)
}

export async function readAsset(
  root: string,
  asset: Omit<AssetWrite, "bytes">,
): Promise<Uint8Array> {
  return readFile(assetPath(root, asset))
}

export async function writeAsset(root: string, asset: AssetWrite): Promise<void> {
  const path = assetPath(root, asset)
  try {
    const existing = await readFile(path)
    if (!Buffer.from(existing).equals(asset.bytes)) corrupt(asset.directory)
    return
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const temporary = resolve(root, asset.directory, `.${asset.digest}-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(asset.bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, path)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      if (!Buffer.from(await readFile(path)).equals(asset.bytes)) corrupt(asset.directory)
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function atomicState(
  root: string,
  destination: string,
  value: unknown,
): Promise<void> {
  const temporary = resolve(root, `.document-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

function corrupt(directory: AssetWrite["directory"]): never {
  throw new StudioError(500, `${directory}_corrupt`, `Persisted ${directory} asset is corrupt`)
}
