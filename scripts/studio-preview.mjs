import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.STUDIO_PREVIEW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const stateDir = resolve(process.env.STUDIO_PREVIEW_STATE_DIR ?? join(root, ".studio-dev"));
const stateFile = join(stateDir, "state.json");
const passwordFile = join(stateDir, "password");
const logFile = join(stateDir, "studio.log");
const lockFile = join(stateDir, "operation.lock");
const port = Number(process.env.STUDIO_PREVIEW_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid preview port");
const localOrigin = `http://127.0.0.1:${port}/`;
const readyTimeout = Number(process.env.STUDIO_PREVIEW_READY_TIMEOUT_MS ?? 30_000);
const routeTimeout = Number(process.env.STUDIO_PREVIEW_ROUTE_TIMEOUT_MS ?? 30_000);

function usage(stream = process.stdout) {
  stream.write(`usage: studio-preview.sh <command> [--local]\n
commands:
  start [--local]    start or reuse the detached Studio
  status             report owned Studio state
  stop               stop only the owned Studio process
  restart [--local]  stop, rebuild if needed, and start Studio
`);
}

function die(message, code = 1) {
  process.stderr.write(`studio-preview: ${message}\n`);
  process.exit(code);
}

function parseArguments() {
  const [command, ...options] = process.argv.slice(2);
  if (command === "--help" || command === "-h") return { command: "help", local: false };
  if (!command) return { command: "help", local: false };
  if (!["start", "status", "stop", "restart"].includes(command)) die(`unknown command: ${command}`, 2);
  let local = false;
  for (const option of options) {
    if (option === "--local" && ["start", "restart"].includes(command)) local = true;
    else die(`unknown option for ${command}: ${option}`, 2);
  }
  return { command, local };
}

function ensureStateDirectory() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
}

function readState() {
  try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return undefined; }
}

function saveState(state) {
  ensureStateDirectory();
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(stateFile, 0o600);
}

function processStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[19];
  } catch { return undefined; }
}

function isOwned(state) {
  return Number.isInteger(state?.pid) && typeof state.procStart === "string"
    && processStart(state.pid) === state.procStart;
}

async function health(instance) {
  try {
    const response = await fetch(`${localOrigin}health`, { signal: AbortSignal.timeout(750) });
    const body = await response.json();
    return response.ok && body.service === "pump-studio" && body.ready === true && body.instance === instance;
  } catch { return false; }
}

const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));

async function waitForHealth(instance) {
  const deadline = Date.now() + readyTimeout;
  while (Date.now() < deadline) {
    if (await health(instance)) return;
    await sleep(100);
  }
  throw new Error(`Studio did not become ready; see ${logFile}`);
}

function ensurePassword() {
  ensureStateDirectory();
  if (!existsSync(passwordFile)) {
    writeFileSync(passwordFile, `studio:${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  }
  chmodSync(passwordFile, 0o600);
}

function build() {
  if (process.env.STUDIO_PREVIEW_SKIP_BUILD === "1" || process.env.STUDIO_PREVIEW_SERVER) return;
  const result = spawnSync("sh", [join(root, "scripts/studio-prerequisites.sh"), "build"], {
    cwd: root, stdio: "inherit", env: process.env,
  });
  if (result.status !== 0) throw new Error("Studio prerequisite/build step failed");
}

function launch(instance, publicOrigin, local) {
  ensureStateDirectory();
  ensurePassword();
  const node = process.env.STUDIO_PREVIEW_NODE ?? process.execPath;
  const server = process.env.STUDIO_PREVIEW_SERVER ?? join(root, "web/dist/server.js");
  const output = openSync(logFile, "a", 0o600);
  chmodSync(logFile, 0o600);
  const child = spawn(node, process.env.STUDIO_PREVIEW_SERVER ? [server] : ["--env-file-if-exists=.env", server], {
    cwd: process.env.STUDIO_PREVIEW_SERVER ? root : join(root, "web"),
    detached: true,
    stdio: ["ignore", output, output],
    env: {
      ...process.env,
      STUDIO_PORT: String(port),
      STUDIO_REPO_ROOT: root,
      STUDIO_INSTANCE_ID: instance,
      STUDIO_PASSWORD_FILE: passwordFile,
      STUDIO_PUBLIC_ORIGIN: local ? undefined : publicOrigin,
    },
  });
  closeSync(output);
  child.unref();
  const procStart = processStart(child.pid);
  if (!procStart) throw new Error("could not record Studio process identity");
  const state = { pid: child.pid, procStart, instance, port, local, origin: local ? localOrigin : publicOrigin };
  saveState(state);
  return state;
}

async function stopOwned({ quiet = false } = {}) {
  const state = readState();
  if (!state) { if (!quiet) process.stdout.write("Studio is stopped.\n"); return false; }
  if (!isOwned(state)) {
    rmSync(stateFile, { force: true });
    if (!quiet) process.stdout.write("Studio stale state removed; no process was killed.\n");
    return false;
  }
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (processStart(state.pid) === state.procStart && Date.now() < deadline) await sleep(50);
  if (processStart(state.pid) === state.procStart) process.kill(state.pid, "SIGKILL");
  rmSync(stateFile, { force: true });
  if (!quiet) process.stdout.write("Studio stopped.\n");
  return true;
}

function routeFrom(output) {
  const parsed = JSON.parse(output);
  return parsed.urls?.find(route => route.ingress === "shared" && route.target?.port === port
    && (!route.target.containers || route.target.containers.length === 0)
    && (route.subdomain?.endsWith("--studio") || route.url?.includes("--studio.")));
}

function dim(arguments_) {
  const result = spawnSync(process.env.STUDIO_PREVIEW_DIM_EXPOSE ?? "dim-expose", arguments_, { encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(`dim-expose failed: ${(result.stderr || result.stdout).trim()}`);
  try { return routeFrom(result.stdout); } catch { throw new Error("dim-expose returned invalid JSON"); }
}

async function approvedRoute() {
  let route = dim(["--name", "studio", "--port", String(port), "--ingress", "shared"]);
  const deadline = Date.now() + routeTimeout;
  while (route?.approval !== "approved" && Date.now() < deadline) {
    await sleep(250);
    route = dim(["list"]) ?? route;
  }
  if (!route) throw new Error("dim-expose did not return the studio route");
  if (route.approval !== "approved") {
    const error = new Error(`route ${route.id ?? "(unknown id)"} is ${route.approval ?? "pending"}; Studio remains running`);
    error.route = route;
    throw error;
  }
  if (typeof route.url !== "string" || !route.url.startsWith("https://")) throw new Error("approved route has no HTTPS URL");
  return route;
}

function validatePublic(origin) {
  const result = spawnSync(process.env.STUDIO_PREVIEW_CURL ?? "curl", ["--silent", "--show-error", "--dump-header", "-", "--output", "/dev/null", "--max-time", "15", origin], { encoding: "utf8" });
  const headers = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0 || !/^HTTP\/\S+ 401\b/m.test(headers) || !/^www-authenticate:\s*Basic\b/im.test(headers)) {
    throw new Error(`public route validation failed for ${origin}; Studio remains running`);
  }
}

async function start(local) {
  const existing = readState();
  if (isOwned(existing) && await health(existing.instance) && existing.local === local) {
    if (local || existing.approval === "approved") {
      if (!local) validatePublic(existing.origin);
      process.stdout.write(`${existing.origin}\n`);
      if (!local) process.stderr.write(`Sign in as studio; private credential: ${passwordFile}\n`);
      return;
    }
  }
  if (isOwned(existing)) await stopOwned({ quiet: true });
  else if (existing) rmSync(stateFile, { force: true });
  build();
  const instance = randomUUID();
  let state = launch(instance, "https://pending.invalid/", local);
  await waitForHealth(instance);
  if (local) { process.stdout.write(`${localOrigin}\n`); return; }
  let route;
  try { route = await approvedRoute(); }
  catch (error) {
    if (error.route?.url?.startsWith("https://")) {
      await stopOwned({ quiet: true });
      state = launch(instance, error.route.url, false);
      await waitForHealth(instance);
    }
    throw error;
  }
  await stopOwned({ quiet: true });
  state = launch(instance, route.url, false);
  state.routeId = route.id;
  state.approval = route.approval;
  saveState(state);
  await waitForHealth(instance);
  validatePublic(route.url);
  process.stdout.write(`${route.url}\n`);
  process.stderr.write(`Sign in as studio; private credential: ${passwordFile}\n`);
}

async function status() {
  const state = readState();
  if (isOwned(state) && await health(state.instance)) {
    process.stdout.write(`Studio running: ${state.origin}\n`);
    return 0;
  }
  process.stdout.write("Studio stopped.\n");
  return 1;
}

function acquireLock() {
  ensureStateDirectory();
  try { writeFileSync(lockFile, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
  catch {
    const owner = Number(readFileSync(lockFile, "utf8"));
    try { process.kill(owner, 0); } catch { unlinkSync(lockFile); return acquireLock(); }
    die(`another operation is running (pid ${owner})`);
  }
}

const options = parseArguments();
if (options.command === "help") { usage(); process.exit(0); }
if (options.command === "status") process.exit(await status());
acquireLock();
try {
  if (options.command === "stop") await stopOwned();
  else if (options.command === "restart") { await stopOwned({ quiet: true }); await start(options.local); }
  else await start(options.local);
} catch (error) {
  process.stderr.write(`studio-preview: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(lockFile, { force: true });
}
