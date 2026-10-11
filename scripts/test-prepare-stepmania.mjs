import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePumpBinary } from "./pump-binary.mjs";
import { createSymlinkFixture } from "./signing-test-helpers.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/prepare-stepmania.mjs");
const binary = resolvePumpBinary();
const work = mkdtempSync(join(tmpdir(), "pump-prepare-stepmania-"));
const seed = "00".repeat(32);
const expectedAudio = "02c6a61ec8f58b47ec56a5637d2a1c25f344d4490c7655e962c789dfeafb5f1a";
const expectedCandidates = [
  "a4b6f86c336d7e10dcd89492ec0d1f0ad4cf0941646bf95a0f141ca4267e317e",
  "9961b82a169603c26d95f60fb396ba5f53d0ece932e3c182a3a7556a4a6207cc",
];
const read = path => JSON.parse(readFileSync(path, "utf8"));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");

function prepare(arguments_, environment = {}) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false, timeout: 180000,
    env: { ...process.env, PUMP_BINARY: binary, ...environment },
  });
}

function run(arguments_) {
  const result = prepare(arguments_);
  assert.equal(result.status, 0, `${arguments_.join(" ")}\n${result.stderr}\n${result.error ?? ""}`);
  return JSON.parse(result.stdout);
}

function reject(arguments_, reason, output) {
  const result = prepare(arguments_);
  assert.equal(result.status, 1, `${arguments_.join(" ")} unexpectedly returned ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, reason);
  if (output) assert.equal(existsSync(output), false, `rejected command created ${output}`);
  return result;
}

function generate(bundle, history) {
  const result = spawnSync(binary, ["chart", "generate", bundle, "--seed", seed,
    ...history.flatMap(value => ["--history", value]), "--format", "json"], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false, timeout: 180000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).generated ?? JSON.parse(result.stdout);
}

try {
  const help = prepare(["--help"], { PUMP_BINARY: join(work, "not-built") });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--out <path>/);
  assert.match(help.stdout, /--bundle <path>/);
  assert.match(help.stdout, /history-distinct retained candidates/);

  const defaultOutput = join(work, "default output with spaces");
  const defaultResult = run(["--out", defaultOutput]);
  assert.equal(defaultResult.output, defaultOutput);
  assert.deepEqual(defaultResult.songs, [
    "Songs/PUMP Generated/01-Taps",
    "Songs/PUMP Generated/02-Holds",
  ]);
  const summary = read(join(defaultOutput, "preparation.json"));
  assert.equal(summary.mode, "demo");
  assert.equal(summary.seed, seed);
  assert.equal(summary.source.audio_sha256, expectedAudio);
  assert.deepEqual(summary.songs.map(song => song.candidate_id), expectedCandidates);
  assert.deepEqual(summary.songs.map(song => song.classification), ["taps", "holds"]);
  assert.deepEqual(summary.songs.map(song => song.history), [[], [expectedCandidates[0]]]);
  assert.equal(hash(join(defaultOutput, summary.source.audio)), expectedAudio);
  assert.equal(lstatSync(join(defaultOutput, "source/chart.bundle")).isDirectory(), true);
  assert.equal(lstatSync(join(defaultOutput, "README.txt")).isFile(), true);

  for (const song of summary.songs) {
    const folder = join(defaultOutput, song.folder);
    const replay = read(join(folder, "replay.json"));
    const expected = generate(join(defaultOutput, summary.source.bundle), song.history);
    assert.equal(replay.schema_version, 2);
    assert.equal(replay.selection.candidate_id, song.candidate_id);
    assert.equal(replay.request.seed, seed);
    assert.deepEqual(replay.request.history, song.history);
    assert.deepEqual(replay.chart, expected.chart);
    assert.equal(replay.artifacts.audio_sha256, expectedAudio);
    assert.equal(hash(join(folder, replay.artifacts.audio_file)), expectedAudio);
    assert.equal(hash(join(folder, replay.artifacts.ssc_file)), replay.artifacts.ssc_sha256);
    assert.match(readFileSync(join(folder, "chart.ssc"), "utf8"), /#METER:1;/);
  }

  const customOutput = join(work, "custom output with spaces");
  run(["--out", customOutput, "--bundle", join(defaultOutput, summary.source.bundle),
    "--audio", join(defaultOutput, summary.source.audio), "--seed", seed,
    "--history", expectedCandidates[0], "--history", expectedCandidates[1],
    "--title", "Custom Test", "--artist", "CLI Artist"]);
  const custom = read(join(customOutput, "preparation.json"));
  assert.equal(custom.mode, "custom");
  assert.equal(custom.songs.length, 1);
  assert.equal(custom.songs[0].candidate_id, expectedCandidates[0]);
  assert.deepEqual(custom.songs[0].history, expectedCandidates);
  assert.equal(custom.songs[0].title, "Custom Test");
  assert.equal(custom.songs[0].artist, "CLI Artist");
  const customReplay = read(join(customOutput, custom.songs[0].replay));
  assert.equal(customReplay.selection.allow_repeat_fallback, true);
  assert.deepEqual(customReplay.chart, generate(join(customOutput, custom.source.bundle), custom.songs[0].history).chart);

  const invalidSeedOutput = join(work, "invalid seed");
  reject(["--out", invalidSeedOutput, "--seed", "bad"], /64 hexadecimal/, invalidSeedOutput);
  const bundleOnlyOutput = join(work, "bundle only");
  reject(["--out", bundleOnlyOutput, "--bundle", join(defaultOutput, summary.source.bundle)], /supplied together/, bundleOnlyOutput);
  const audioOnlyOutput = join(work, "audio only");
  reject(["--out", audioOnlyOutput, "--audio", join(defaultOutput, summary.source.audio)], /supplied together/, audioOnlyOutput);
  const missingOutput = join(work, "missing source");
  reject(["--out", missingOutput, "--bundle", join(work, "absent.bundle"), "--audio", join(work, "absent.wav")], /not accessible/, missingOutput);
  const unknownOutput = join(work, "unknown option");
  reject(["--out", unknownOutput, "--bogus", "value"], /unknown option/, unknownOutput);

  const existing = join(work, "existing-output");
  writeFileSync(existing, "preserve me");
  reject(["--out", existing], /already exists/);
  assert.equal(readFileSync(existing, "utf8"), "preserve me");
  const danglingTarget = join(work, "absent-target");
  const danglingOutput = join(work, "dangling-output");
  if (createSymlinkFixture(danglingTarget, danglingOutput, "dangling output defense")) {
    reject(["--out", danglingOutput], /already exists/);
    assert.equal(lstatSync(danglingOutput).isSymbolicLink(), true);
  }

  console.log(JSON.stringify({ prepare_stepmania: "passed", default_output: defaultOutput,
    songs: summary.songs.map(song => ({ folder: song.folder, candidate_id: song.candidate_id })), custom_output: customOutput }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
