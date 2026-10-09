import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve("dist/pump");
const work = mkdtempSync(join(tmpdir(), "pump-package-feedback-"));
const source = join(work, "source");
const store = join(work, "store");
const seed = "00".repeat(32);
const contract = resolve("dist/package-feedback/contract.json");
const runtime = resolve("dist/chart-runtime.component.wasm");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = bytes => Buffer.from(bytes).toString("hex");

function call(args) {
  return spawnSync(binary, [...args, "--format", "json"], { encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
}
function run(args) {
  const result = call(args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
function reject(args, reason) {
  const result = call(args);
  assert.equal(result.status, 1, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  assert.match(error.error, reason);
}
function replaceArtifact(root, name, value) {
  save(join(root, name), value);
  const manifest = read(join(root, "manifest.json"));
  manifest.files[name] = hash(readFileSync(join(root, name)));
  save(join(root, "manifest.json"), manifest);
}

try {
  mkdirSync(source);
  for (const name of ["song-a", "song-b", "song-correlated", "pattern", "style-calm", "style-bold"]) {
    cpSync(`dist/${name}.component.wasm`, join(source, `${name}.component.wasm`));
  }
  const audio = join(work, "excerpt.wav");
  const wave = spawnSync(process.execPath, ["scripts/make-feedback-audio.mjs", audio], { encoding: "utf8" });
  assert.equal(wave.status, 0, wave.stderr);
  for (const name of ["song-a", "song-b", "song-correlated"]) {
    const manifestPath = join(source, `${name}.package.json`);
    cpSync(`dist/${name}.package.json`, manifestPath);
    const lock = join(work, `${name}.lock.json`);
    run(["package", "resolve", manifestPath, "--out", lock]);
    if (name === "song-a") writeFileSync(lock, `${JSON.stringify(read(lock))}\n\n`);
    run(["package", "cache", manifestPath, "--lock", lock, "--store", store]);
    const out = join(work, `${name}.source.bundle`);
    run(["chart", "compile-package", manifestPath, "--lock", lock, "--runtime", runtime,
      "--music", `dist/package-feedback/${name}.music.json`, "--contract", contract, "--audio", audio, "--out", out]);
    const manifest = read(join(out, "manifest.json"));
    assert.equal(manifest.package_bridge.adapter, "v1-correlated-plan-to-v2-finite@1");
    assert.equal(manifest.package_bridge.source_codec, "PRTP@1");
    assert.equal(manifest.package_bridge.seed_mapping, "v2-new-seeds-v1-replay-unchanged");
    assert.equal(Object.keys(manifest.files).length, 11);
    assert.equal(run(["chart", "verify", out, "--audio", audio]).reproduced, true);
    assert.deepEqual(readFileSync(lock), readFileSync(join(out, "package.lock.json")));
  }

  reject(["chart", "compile-package", join(source, "song-b.package.json"), "--lock", join(work, "song-b.lock.json"),
    "--runtime", runtime, "--music", "dist/package-feedback/song-a.music.json", "--contract", contract,
    "--out", join(work, "wrong-span")], /source duration 7 differs from music duration 5/);
  rmSync(source, { recursive: true });
  const traceCounts = {};
  for (const name of ["song-a", "song-b", "song-correlated"]) {
    const out = join(work, `${name}.locked.bundle`);
    run(["chart", "compile-locked", join(work, `${name}.lock.json`), "--store", store, "--runtime", runtime,
      "--music", `dist/package-feedback/${name}.music.json`, "--contract", contract, "--out", out]);
    const baseline = join(work, `${name}.source.bundle`);
    assert.deepEqual(readdirSync(out).sort(), readdirSync(baseline).sort());
    for (const file of readdirSync(baseline)) assert.deepEqual(readFileSync(join(out, file)), readFileSync(join(baseline, file)), file);
    const report = run(["chart", "analyze", out]);
    assert.equal(report.distribution.retained_candidates, 2);
    const bridge = read(join(out, "bridge-report.json"));
    assert.equal(bridge.statistics.source_derivations, 2);
    assert.equal(bridge.statistics.unique_charts, 2);
    assert.deepEqual(bridge.statistics.total_prior_mass, { numerator: 1, denominator: 1 });
    const trace = run(["chart", "generate", out, "--seed", seed]);
    assert.ok(trace.chart.notes.every(note => note.hold_ticks === 0));
    traceCounts[name] = trace.chart.notes.length;
  }

  const correlated = join(work, "song-correlated.locked.bundle");
  const report = run(["chart", "analyze", correlated]);
  assert.deepEqual(report.candidates.map(candidate => `${candidate.original_mass.numerator}/${candidate.original_mass.denominator}`).sort(), ["1/6", "5/6"]);
  for (const candidate of report.candidates) {
    const other = report.candidates.find(item => item !== candidate);
    const trace = run(["chart", "generate", correlated, "--seed", seed, "--history", other.candidate_id]);
    assert.equal(hex(trace.candidate_id), candidate.candidate_id);
    assert.equal(trace.chart.span_ticks, 10);
    const first = trace.chart.notes.filter(note => note.tick < 5);
    const second = trace.chart.notes.filter(note => note.tick >= 5).map(note => ({ ...note, tick: note.tick - 5 }));
    assert.deepEqual(first, second, "v1 correlated choices must not become independent");
    assert.ok(trace.chart.notes.length === 2 || trace.chart.notes.length === 10);
  }

  const forged = join(work, "forged");
  cpSync(correlated, forged, { recursive: true });
  const bridge = read(join(forged, "bridge-report.json"));
  bridge.statistics.source_derivations += 1;
  replaceArtifact(forged, "bridge-report.json", bridge);
  reject(["chart", "verify", forged], /reproduced bridge statistics/);
  reject(["chart", "generate", forged, "--seed", seed], /reproduced bridge statistics/);

  const privateKey = join(work, "release.key");
  const publicKey = join(work, "release.pub");
  run(["chart", "keygen", "--private", privateKey, "--public", publicKey]);
  run(["chart", "sign", correlated, "--key", privateKey]);
  assert.equal(run(["chart", "verify", correlated, "--trusted-key", publicKey]).authenticity, true);
  const stripped = join(work, "stripped");
  cpSync(correlated, stripped, { recursive: true });
  const manifest = read(join(stripped, "manifest.json"));
  delete manifest.package_bridge;
  for (const name of ["package.lock.json", "package-invocations.json", "source-plan-v1.bin", "bridge-report.json"]) {
    delete manifest.files[name];
    rmSync(join(stripped, name));
  }
  save(join(stripped, "manifest.json"), manifest);
  reject(["chart", "verify", stripped, "--trusted-key", publicKey], /signature manifest binding/);
  console.log(JSON.stringify({ package_feedback: "passed", correlated_outcomes: 2, source_free_reproduction: true, trace_counts: traceCounts }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
