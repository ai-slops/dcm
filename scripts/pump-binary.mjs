import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export function resolvePumpBinary(platform = process.platform, environment = process.env) {
  const executable = platform === "win32" ? "pump.exe" : "pump";
  return resolve(environment.PUMP_BINARY ?? join(repoRoot, "dist", executable));
}
