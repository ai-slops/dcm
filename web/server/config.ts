import { resolve } from "node:path"

import { z } from "zod"

const EnvironmentSchema = z
  .object({
    STUDIO_DATA: z.string().min(1).optional(),
    STUDIO_REPO_ROOT: z.string().min(1).optional(),
    STUDIO_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
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
  return {
    dataRoot: resolve(parsed.STUDIO_DATA ?? resolve(repoRoot, ".pump-studio")),
    repoRoot,
    clientRoot: resolve(repoRoot, "web/dist/client"),
    port,
    allowedHosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`, "127.0.0.1", "localhost"]),
    allowedOrigins: new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]),
    ...(endpoint !== undefined && model !== undefined
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
