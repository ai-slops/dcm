import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"

import ky from "ky"
import { z } from "zod"

import { type ProviderModel, ProviderModelSchema } from "../../shared/provider.ts"

const ConnectionSchema = z.object({
  schemaVersion: z.literal(1),
  endpoint: z.string().url(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})
const CatalogSchema = z.object({ models: z.array(ProviderModelSchema).min(1).max(128) })

export class ProviderDiscoveryError extends Error {
  override readonly name = "ProviderDiscoveryError"
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type DimConnection = {
  readonly origin: URL
  readonly token: string
  readonly models: readonly ProviderModel[]
}

export async function discoverDimRouter(connectionFile?: string): Promise<DimConnection> {
  const file = connectionFile ?? resolve(homedir(), ".config/dim/llm-router.json")
  let connection: z.infer<typeof ConnectionSchema>
  try {
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const stat = await handle.stat()
      if (
        !stat.isFile() ||
        stat.uid !== process.geteuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size > 64 * 1024
      ) {
        throw new ProviderDiscoveryError(
          "dim_connection_permissions",
          "DIM connection must be a private, user-owned regular file",
        )
      }
      connection = ConnectionSchema.parse(JSON.parse(await handle.readFile("utf8")))
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof ProviderDiscoveryError) throw error
    throw new ProviderDiscoveryError(
      "dim_connection_unavailable",
      "Workspace DIM router connection is unavailable or invalid; ask the operator to check the workspace attachment",
    )
  }
  const origin = new URL(connection.endpoint)
  if (
    origin.origin !== connection.endpoint ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  ) {
    throw new ProviderDiscoveryError(
      "dim_connection_invalid",
      "DIM router requires a credential-free HTTP(S) origin",
    )
  }
  try {
    const response = await ky.get(new URL("/v1/capabilities", origin), {
      headers: { authorization: `Bearer ${connection.token}` },
      redirect: "error",
      retry: 0,
      timeout: 10_000,
    })
    const reader = response.body?.getReader()
    if (reader === undefined)
      throw new ProviderDiscoveryError(
        "dim_catalog_invalid",
        "DIM router returned an empty catalog",
      )
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const item = await reader.read()
        if (item.done) break
        size += item.value.byteLength
        if (size > 1024 * 1024) {
          await reader.cancel()
          throw new ProviderDiscoveryError(
            "dim_catalog_limit",
            "DIM router catalog exceeds its size limit",
          )
        }
        chunks.push(item.value)
      }
    } finally {
      reader.releaseLock()
    }
    const catalog = CatalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    if (new Set(catalog.models.map((model) => model.id)).size !== catalog.models.length) {
      throw new ProviderDiscoveryError(
        "dim_catalog_invalid",
        "DIM router returned duplicate model IDs",
      )
    }
    return { origin, token: connection.token, models: catalog.models }
  } catch (error) {
    if (error instanceof ProviderDiscoveryError) throw error
    throw new ProviderDiscoveryError(
      "dim_discovery_failed",
      "DIM router model discovery failed; check workspace attachment and allowed model capabilities",
    )
  }
}
