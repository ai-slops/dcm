import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

import { z } from "zod"

const EnvironmentSchema = z
  .object({
    STUDIO_DATA: z.string().min(1).optional(),
    STUDIO_REPO_ROOT: z.string().min(1).optional(),
    STUDIO_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    STUDIO_PUBLIC_ORIGIN: z.url().optional(),
    STUDIO_PASSWORD_FILE: z.string().min(1).optional(),
    STUDIO_INSTANCE_ID: z.string().optional(),
    PART_ENDPOINT: z.url().optional(),
    PART_MODEL: z.string().min(1).optional(),
    PART_API_KEY: z.string().min(1).optional(),
  })
  .passthrough()

export type StudioConfig = {
  readonly dataRoot: string
  readonly repoRoot: string
  readonly clientRoot: string
  readonly port: number
  readonly allowedHosts: ReadonlySet<string>
  readonly allowedOrigins: ReadonlySet<string>
  readonly publicAccess?: { readonly origin: string; readonly password: string }
  readonly instanceId: string
  readonly part?: {
    readonly endpoint: URL
    readonly model: string
    readonly apiKey?: string
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv): StudioConfig {
  const parsed = EnvironmentSchema.parse(environment)
  const repoRoot = resolve(parsed.STUDIO_REPO_ROOT ?? "..")
  const port = parsed.STUDIO_PORT ?? 4173
  const endpoint = parsed.PART_ENDPOINT
  const model = parsed.PART_MODEL
  const publicOrigin =
    parsed.STUDIO_PUBLIC_ORIGIN === undefined ? undefined : new URL(parsed.STUDIO_PUBLIC_ORIGIN)
  let publicAccess: StudioConfig["publicAccess"]
  if (publicOrigin !== undefined) {
    if (
      publicOrigin.protocol !== "https:" ||
      publicOrigin.username ||
      publicOrigin.password ||
      publicOrigin.pathname !== "/" ||
      publicOrigin.search ||
      publicOrigin.hash
    ) {
      throw new Error("STUDIO_PUBLIC_ORIGIN must be an HTTPS origin without credentials or a path")
    }
    const passwordFile = parsed.STUDIO_PASSWORD_FILE
    if (passwordFile === undefined || (statSync(passwordFile).mode & 0o077) !== 0) {
      throw new Error("Public Studio requires an owner-only STUDIO_PASSWORD_FILE")
    }
    const credential = readFileSync(passwordFile, "utf8").trim()
    if (!/^studio:[A-Za-z0-9_-]{16,}$/.test(credential)) {
      throw new Error("STUDIO_PASSWORD_FILE must contain studio: followed by a private password")
    }
    publicAccess = { origin: publicOrigin.origin, password: credential.slice("studio:".length) }
  }
  return {
    dataRoot: resolve(parsed.STUDIO_DATA ?? resolve(repoRoot, ".pump-studio")),
    repoRoot,
    clientRoot: resolve(repoRoot, "web/dist/client"),
    port,
    instanceId: parsed.STUDIO_INSTANCE_ID ?? "foreground",
    ...(publicAccess === undefined ? {} : { publicAccess }),
    allowedHosts: new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      "127.0.0.1",
      "localhost",
      ...(publicOrigin === undefined ? [] : [publicOrigin.host]),
    ]),
    allowedOrigins: new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      ...(publicOrigin === undefined ? [] : [publicOrigin.origin]),
    ]),
    ...(publicAccess === undefined && endpoint !== undefined && model !== undefined
      ? {
          part: {
            endpoint: new URL(endpoint),
            model,
            ...(parsed.PART_API_KEY === undefined ? {} : { apiKey: parsed.PART_API_KEY }),
          },
        }
      : {}),
  }
}
