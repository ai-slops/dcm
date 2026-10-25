import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.log("Studio owned-process regression is Linux-only; use the foreground workflow on other platforms.");
  process.exit(0);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const manager = join(root, "scripts/studio-preview.mjs");
const work = mkdtempSync(join(tmpdir(), "pump-studio-preview-"));
const stateDir = join(work, "state");
const binDir = join(work, "bin");
const server = join(work, "fixture-server.mjs");
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const address = reservation.address();
assert.ok(address && typeof address === "object");
const port = address.port;
await new Promise(resolve => reservation.close(resolve));
const localOrigin = `http://127.0.0.1:${port}/`;
const env = {
  ...process.env,
  PATH: `${binDir}:${process.env.PATH}`,
  STUDIO_PREVIEW_ROOT: work,
  STUDIO_PREVIEW_STATE_DIR: stateDir,
  STUDIO_PREVIEW_SERVER: server,
  STUDIO_PREVIEW_NODE: process.execPath,
  STUDIO_PREVIEW_SKIP_BUILD: "1",
  STUDIO_PREVIEW_PORT: String(port),
  STUDIO_PREVIEW_READY_TIMEOUT_MS: "5000",
  STUDIO_PREVIEW_ROUTE_TIMEOUT_MS: "1000",
  PART_API_KEY: "test-only-part-sentinel",
  OPENAI_API_KEY: "test-only-upstream-sentinel",
};

function executable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function run(args, expected = 0, extraEnv = {}) {
  const result = spawnSync(process.execPath, [manager, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
    timeout: 15000,
  });
  assert.equal(result.status, expected, `${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result;
}

try {
  mkdirSync(binDir);
  const prerequisites = readFileSync(join(root, "scripts/studio-prerequisites.sh"), "utf8");
  assert.match(prerequisites, /NODE_VERSION=24\.22\.0/);
  assert.match(prerequisites, /COREPACK_VERSION=0\.36\.0/);
  assert.match(prerequisites, /PNPM_VERSION=10\.17\.1/);
  assert.match(prerequisites, /RUST_VERSION=1\.94\.0/);
  assert.match(prerequisites, /WASM_TOOLS_VERSION=1\.254\.0/);
  assert.match(prerequisites, /pump-chart-author-component.*pump-chart-runtime-component/);
  assert.doesNotMatch(prerequisites, /node_modules\/\.bin/);
  assert.doesNotMatch(prerequisites, /scripts\/build\.sh|docker/i);
  writeFileSync(server, `
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
const instance = process.env.STUDIO_INSTANCE_ID;
const publicMode = Boolean(process.env.STUDIO_PUBLIC_ORIGIN);
const keys = ["PART_API_KEY", "OPENAI_API_KEY", "PREVIEW_DOTENV_SENTINEL"];
createServer((request, response) => {
  if (request.url === "/health") {
    const child = JSON.parse(spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(" + JSON.stringify(keys) + ".map(name => Boolean(process.env[name]))))"], {encoding:"utf8"}).stdout);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ service: "pump-studio", ready: true, instance, environment:keys.map(name => Boolean(process.env[name])), child }));
    return;
  }
  if (publicMode && request.headers.authorization !== "Basic fixture") {
    response.statusCode = 401;
    response.setHeader("www-authenticate", 'Basic realm="pump-studio"');
    response.end("authentication required");
    return;
  }
  response.end("ok");
}).listen(Number(process.env.STUDIO_PORT), "127.0.0.1");
`);
  writeFileSync(join(work, ".env"), "PREVIEW_DOTENV_SENTINEL=test-only-dotenv-sentinel\n");
  executable(join(binDir, "dim-expose"), `#!/bin/sh
case " $* " in
  *" --name studio --port ${port} --ingress shared "*) ;;
  *" list "*) ;;
  *) exit 64 ;;
esac
printf '%s\n' '{"urls":[{"id":"route-1","ingress":"shared","subdomain":"workspace--studio","target":{"port":${port},"protocol":"http"},"url":"https://workspace--studio.example/","approval":"approved"}]}'
`);
  executable(join(binDir, "curl"), `#!/bin/sh
printf '%s\n' 'HTTP/2 401' 'www-authenticate: Basic realm="pump-studio"' ''
`);

  assert.match(run(["--help"]).stdout, /start \[--local\].*status.*stop.*restart/s);
  assert.match(run(["start", "--bogus"], 2).stderr, /unknown option/);
  assert.match(run(["wat"], 2).stderr, /unknown command/);

  const local = run(["start", "--local"]);
  assert.equal(local.stdout.trim(), localOrigin);
  const localHealth = await (await fetch(`${localOrigin}health`)).json();
  assert.deepEqual(localHealth.environment, [true, true, true]);
  assert.deepEqual(localHealth.child, [true, true, true]);
  const password = join(stateDir, "password");
  assert.equal(statSync(password).mode & 0o777, 0o600);
  assert.match(readFileSync(password, "utf8"), /^studio:[A-Za-z0-9_-]{32,}\n$/);
  assert.doesNotMatch(`${local.stdout}${local.stderr}`, /studio:[A-Za-z0-9_-]/);
  const firstState = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));
  const reused = run(["start", "--local"]);
  assert.equal(JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8")).pid, firstState.pid);
  assert.equal(reused.stdout.trim(), localOrigin);
  assert.ok(run(["status"]).stdout.includes(localOrigin));
  run(["stop"]);
  assert.match(run(["status"], 1).stdout, /stopped/);

  const publicStart = run(["start"]);
  assert.equal(publicStart.stdout.trim(), "https://workspace--studio.example/");
  assert.doesNotMatch(`${publicStart.stdout}${publicStart.stderr}`, /studio:[A-Za-z0-9_-]/);
  const publicState = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));
  assert.equal(publicState.approval, "approved");
  const publicHealth = await (await fetch(`${localOrigin}health`)).json();
  assert.deepEqual(publicHealth.environment, [false, false, false]);
  assert.deepEqual(publicHealth.child, [false, false, false]);
  run(["start"]);
  assert.equal(JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8")).pid, publicState.pid);
  assert.match(run(["status"]).stdout, /https:\/\/workspace--studio\.example\//);
  const restarted = run(["restart", "--local"]);
  assert.equal(restarted.stdout.trim(), localOrigin);
  run(["stop"]);

  const sleeper = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  sleeper.unref();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.json"), JSON.stringify({
    pid: sleeper.pid,
    procStart: "wrong",
    instance: "stale",
    port,
    local: true,
  }));
  assert.match(run(["stop"]).stdout, /stale state removed/);
  assert.doesNotThrow(() => process.kill(sleeper.pid, 0));
  process.kill(sleeper.pid, "SIGKILL");

  const failedDim = join(work, "failed-dim");
  executable(failedDim, "#!/bin/sh\nprintf '%s\\n' 'route unavailable' >&2\nexit 1\n");
  const failedRoute = run(["start"], 1, { STUDIO_PREVIEW_ROUTE_TIMEOUT_MS: "200", STUDIO_PREVIEW_DIM_EXPOSE: failedDim });
  assert.match(failedRoute.stderr, /dim-expose|approved route/);
  assert.match(run(["status"]).stdout, /running/);
  run(["stop"]);

  const pendingDim = join(work, "pending-dim");
  executable(pendingDim, `#!/bin/sh
printf '%s\n' '{"urls":[{"id":"pending-route-42","ingress":"shared","subdomain":"workspace--studio","target":{"port":${port},"containers":[]},"url":"https://workspace--studio.example/","approval":"pending"}]}'
`);
  const pending = run(["start"], 1, { STUDIO_PREVIEW_ROUTE_TIMEOUT_MS: "200", STUDIO_PREVIEW_DIM_EXPOSE: pendingDim });
  assert.match(pending.stderr, /route pending-route-42 is pending/);
  assert.equal(pending.stdout, "");
  assert.match(run(["status"]).stdout, /running/);
  run(["stop"]);

  console.log("Studio preview regression passed.");
} finally {
  spawnSync(process.execPath, [manager, "stop"], { cwd: root, env, encoding: "utf8", timeout: 5000 });
  rmSync(work, { recursive: true, force: true });
}
