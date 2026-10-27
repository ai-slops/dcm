import { basename, resolve } from "node:path"

import type { StudioProjectV1 } from "../../shared/index.ts"

export function exportFilename(project: StudioProjectV1): string {
  return `${basename(project.title.replaceAll(/[^A-Za-z0-9._-]/g, "-") || "pump-chart")}.zip`
}

export function nativeExecutable(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolve(repoRoot, "dist", platform === "win32" ? "pump.exe" : "pump")
}
