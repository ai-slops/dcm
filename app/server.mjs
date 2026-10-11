import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const binary = process.env.PUMP_BINARY ?? `${root}dist/pump`;
const bundle = process.env.PUMP_BUNDLE ?? `${root}bundle`;
let active = 0;

function send(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function ready() {
  try {
    await access(binary, constants.X_OK);
    await execute(binary, ["verify", bundle, "--format", "json"], {
      timeout: 10_000,
      maxBuffer: 65_536,
    });
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET") {
      send(response, 405, { error: "Only GET is supported" });
      return;
    }
    const url = new URL(request.url, "http://localhost");
    switch (url.pathname) {
      case "/":
      case "/health":
        send(response, 200, {
          service: "pump-chart-toolchain",
          ready: await ready(),
          mode: "pump-double-10",
          certification: "development",
          generate: "/api/generate?seed=<64 hexadecimal characters>",
        });
        return;
      case "/api/generate": {
        const seed = url.searchParams.get("seed");
        if (seed === null || !/^[0-9a-fA-F]{64}$/.test(seed)) {
          send(response, 400, { error: "seed must be exactly 64 hexadecimal characters" });
          return;
        }
        if (!(await ready())) {
          send(response, 503, { error: "Build dist artifacts and compile ./bundle first; see README.md" });
          return;
        }
        if (active >= 2) {
          send(response, 429, { error: "Generation capacity reached" });
          return;
        }
        active += 1;
        try {
          const { stdout } = await execute(binary, ["generate", bundle, "--seed", seed, "--format", "json"], {
            cwd: root,
            timeout: 30_000,
            maxBuffer: 16 * 1024 * 1024,
          });
          send(response, 200, JSON.parse(stdout));
        } finally {
          active -= 1;
        }
        return;
      }
      default:
        send(response, 404, { error: "Route not found" });
    }
  } catch {
    send(response, 500, { error: "Generation or artifact access failed; verify the local bundle with the CLI" });
  }
});

server.requestTimeout = 35_000;
server.headersTimeout = 10_000;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(3000, "0.0.0.0");
}
