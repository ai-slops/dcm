import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const zeroSeed = "00".repeat(32);
const usage = `Usage: node scripts/prepare-stepmania.mjs --out <new-directory> [options]

Prepare a standard StepMania Songs group without launching the game.

Options:
  --out <path>       Required new output root; it must not already exist
  --seed <64-hex>    Generation seed (default: 64 zeroes)
  --bundle <path>    Existing chart bundle (requires --audio)
  --audio <path>     Audio bound to --bundle (requires --bundle)
  --history <64-hex> Prior candidate ID; repeatable in custom mode
  --title <text>     ASCII SSC title (optional)
  --artist <text>    ASCII SSC artist (default: PUMP)
  -h, --help         Show this help

Without --bundle and --audio, the built-in feedback demo is compiled and both
history-distinct retained candidates are exported. Custom mode exports one song.
`;

function parse(arguments_) {
  if (arguments_.length === 1 && ["-h", "--help"].includes(arguments_[0])) return { help: true };
  const values = { seed: zeroSeed, history: [] };
  const single = new Set(["--out", "--seed", "--bundle", "--audio", "--title", "--artist"]);
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "-h" || option === "--help") throw new Error("--help must be used alone");
    if (!single.has(option) && option !== "--history") throw new Error(`unknown option: ${option}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    index += 1;
    if (option === "--history") values.history.push(value);
    else {
      const key = option.slice(2);
      if (seen.has(option)) throw new Error(`${option} may be specified only once`);
      seen.add(option);
      values[key] = value;
    }
  }
  return values;
}

function requireHex(value, label) {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be exactly 64 hexadecimal characters`);
  return value.toLowerCase();
}

function requireMetadata(value, label) {
  if (value === undefined) return;
  if (value.length === 0 || Buffer.byteLength(value) > 256 || !/^[\x20-\x7e]+$/.test(value)) {
    throw new Error(`${label} must be 1 to 256 printable ASCII bytes`);
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function requireInput(path, kind, label) {
  let info;
  try {
    info = statSync(path);
  } catch (error) {
    throw new Error(`${label} is not accessible: ${path}`, { cause: error });
  }
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) throw new Error(`${label} must be a ${kind}: ${path}`);
}

function invoke(command, arguments_, json = true) {
  const result = spawnSync(command, arguments_, {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false, timeout: 180000,
  });
  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim() ?? `exit status ${result.status}`;
    throw new Error(`${command} ${arguments_.join(" ")} failed: ${detail}`);
  }
  return json ? JSON.parse(result.stdout) : result.stdout;
}

const id = candidate => Buffer.from(candidate.candidate_id).toString("hex");
const generated = value => value.generated ?? value;
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const classification = candidate => candidate.chart.notes.some(note => note.hold_ticks > 0) ? "Holds" : "Taps";

let published = false;
let stage;
try {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    process.exit(0);
  }
  if (!options.out) throw new Error("--out is required");
  options.seed = requireHex(options.seed, "--seed");
  options.history = options.history.map(value => requireHex(value, "--history"));
  requireMetadata(options.title, "--title");
  requireMetadata(options.artist, "--artist");
  if (Boolean(options.bundle) !== Boolean(options.audio)) throw new Error("--bundle and --audio must be supplied together");
  if (!options.bundle && options.history.length > 0) throw new Error("--history is available only with --bundle and --audio");

  const output = resolve(options.out);
  if (exists(output)) throw new Error(`output path already exists: ${output}`);
  const binary = resolve(process.env.PUMP_BINARY ?? join(repoRoot, "dist/pump"));
  requireInput(binary, "file", "PUMP binary");
  const custom = Boolean(options.bundle);
  const bundleInput = custom ? resolve(options.bundle) : join(repoRoot, "dist/chart-author.component.wasm");
  const audioInput = custom ? resolve(options.audio) : null;
  requireInput(bundleInput, custom ? "directory" : "file", custom ? "bundle" : "demo author component");
  if (custom) requireInput(audioInput, "file", "audio");
  else for (const path of ["dist/chart-runtime.component.wasm", "dist/feedback/music.json", "dist/feedback/contract.json", "dist/feedback/limits.json", "scripts/make-feedback-audio.mjs"]) requireInput(join(repoRoot, path), "file", path);

  stage = mkdtempSync(join(tmpdir(), "pump-stepmania-"));
  const source = join(stage, "source");
  mkdirSync(source);
  const bundle = join(source, "chart.bundle");
  let audio;
  if (custom) {
    audio = join(source, `music${extname(options.audio)}`);
    cpSync(bundleInput, bundle, { recursive: true, dereference: true });
    cpSync(audioInput, audio);
  } else {
    audio = join(source, "music.wav");
    invoke(process.execPath, [join(repoRoot, "scripts/make-feedback-audio.mjs"), audio]);
    invoke(binary, ["chart", "compile", join(repoRoot, "dist/chart-author.component.wasm"),
      "--runtime", join(repoRoot, "dist/chart-runtime.component.wasm"), "--music", join(repoRoot, "dist/feedback/music.json"),
      "--audio", audio, "--contract", join(repoRoot, "dist/feedback/contract.json"), "--limits", join(repoRoot, "dist/feedback/limits.json"),
      "--out", bundle, "--format", "json"]);
  }

  const requests = [];
  const firstHistory = custom ? options.history : [];
  const first = generated(invoke(binary, ["chart", "generate", bundle, "--seed", options.seed,
    ...firstHistory.flatMap(value => ["--history", value]), "--format", "json"]));
  requests.push({ candidate: first, history: firstHistory });
  if (!custom) {
    const secondHistory = [id(first)];
    const second = generated(invoke(binary, ["chart", "generate", bundle, "--seed", options.seed,
      "--history", secondHistory[0], "--format", "json"]));
    if (id(first) === id(second)) throw new Error("demo history exclusion did not select a distinct candidate");
    requests.push({ candidate: second, history: secondHistory });
  }

  const group = join(stage, "Songs", "PUMP Generated");
  mkdirSync(group, { recursive: true });
  const ordered = custom ? requests : requests.toSorted((left, right) => classification(left.candidate).localeCompare(classification(right.candidate))).toReversed();
  const songs = [];
  for (const [index, request] of ordered.entries()) {
    const kind = classification(request.candidate);
    const folderName = `${String(index + 1).padStart(2, "0")}-${kind}`;
    const folder = join(group, folderName);
    const title = options.title ?? (custom ? "PUMP Generated" : `PUMP Generated ${kind}`);
    const artist = options.artist ?? "PUMP";
    invoke(binary, ["chart", "export-ssc", bundle, "--seed", options.seed,
      ...request.history.flatMap(value => ["--history", value]), "--audio", audio, "--out", folder,
      "--title", title, "--artist", artist, "--format", "json"]);
    const replay = JSON.parse(readFileSync(join(folder, "replay.json"), "utf8"));
    if (replay.selection.candidate_id !== id(request.candidate)) throw new Error("exported replay differs from generated candidate");
    songs.push({ folder: relative(stage, folder), classification: kind.toLowerCase(), title, artist,
      candidate_id: id(request.candidate), history: request.history, replay: relative(stage, join(folder, "replay.json")) });
  }

  const summary = { schema_version: 1, mode: custom ? "custom" : "demo", seed: options.seed,
    source: { bundle: "source/chart.bundle", audio: relative(stage, audio), audio_sha256: digest(audio) }, songs };
  writeFileSync(join(stage, "preparation.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  const histories = songs.map(song => `${song.folder}: ${song.history.length ? song.history.join(", ") : "none"}`).join("\n");
  writeFileSync(join(stage, "README.txt"), `StepMania test songs\n\nCopy the group folder Songs/PUMP Generated into your StepMania Songs directory.\nChoose the Pump game, Double style, and Edit chart difficulty in normal gameplay. Meter 1 is uncalibrated.\nUse the bundled default Pump noteskin; no plugin is required. See docs/stepmania.md in the repository for installation and controls.\nThis command prepared files only; it did not launch StepMania or change preferences, skins, or system paths.\n\nSeed: ${options.seed}\nSource bundle: source/chart.bundle\nSource audio: ${relative(stage, audio)}\nHistory by song:\n${histories}\n\nKeep source/chart.bundle, the source audio, and each replay.json together for exact replay reference.\n`, { flag: "wx" });

  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  published = true;
  cpSync(stage, output, { recursive: true });
  process.stdout.write(`${JSON.stringify({ ok: true, output, songs: songs.map(song => song.folder) })}\n`);
} catch (error) {
  const suffix = published ? " The output directory was created and may contain partial files; it was not removed." : "";
  process.stderr.write(`prepare-stepmania: ${error.message}.${suffix}\n`);
  process.exitCode = 1;
} finally {
  if (stage) rmSync(stage, { recursive: true, force: true });
}
