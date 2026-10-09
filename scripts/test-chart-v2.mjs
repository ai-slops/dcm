import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.env.PUMP_BINARY ?? "dist/pump");
const work = mkdtempSync(join(tmpdir(), "pump-feedback-v2-"));
const seed = "00".repeat(32);
const music = resolve("dist/feedback/music.json");
const contract = JSON.parse(readFileSync("dist/feedback/contract.json", "utf8"));
contract.history_policy = { recent_window: 16, max_request_history: 16 };
const contractPath = join(work, "contract.json");
const bundle = join(work, "bundle");
const audio = join(work, "music.wav");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
const read = path => JSON.parse(readFileSync(path, "utf8"));
const id = value => Buffer.from(value).toString("hex");
const generated = value => value.generated ?? value;

function invoke(args) {
  return spawnSync(binary, ["chart", ...args, "--format", "json"], {
    encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024,
  });
}

function run(args) {
  const result = invoke(args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.error ?? ""}`);
  return JSON.parse(result.stdout);
}

function reject(args, reason) {
  const result = invoke(args);
  assert.equal(result.status, 1, `${args.join(" ")} unexpectedly succeeded or crashed\n${result.stderr}`);
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  if (reason) assert.match(error.error, reason);
  return error;
}

function evaluate(chart, profile) {
  const chartPath = join(work, "input-chart.json");
  const profilePath = join(work, "input-contract.json");
  save(chartPath, chart);
  save(profilePath, profile);
  return run(["evaluate", chartPath, "--music", music, "--contract", profilePath]);
}

function permissive() {
  const profile = structuredClone(contract);
  profile.intents = [];
  profile.difficulty.local_windows = [];
  for (const key of ["density", "movement", "brackets", "hold_occupancy", "local_load", "total"]) {
    profile.difficulty[key] = { minimum: 0, maximum: 1000000 };
  }
  profile.foot_model.micros_per_panel_unit = 1000;
  profile.foot_model.bracket_setup_micros = 1000;
  return profile;
}

const rule = (name, kind, credit = "shared", threshold = 1) => ({
  id: name, kind, requiredness: "required", credit_policy: credit, threshold, weight: 1,
});
const chart = notes => ({ ticks_per_beat: 4, span_ticks: 32, notes });
const tap = (tick, panel_mask) => ({ tick, panel_mask, hold_ticks: 0 });

try {
  save(contractPath, contract);
  const wave = spawnSync(process.execPath, ["scripts/make-feedback-audio.mjs", audio], { encoding: "utf8" });
  assert.equal(wave.status, 0, wave.stderr);
  const audioInfo = JSON.parse(wave.stdout);
  assert.equal(id(read(music).audio_sha256), audioInfo.audio_digest);
  run(["compile", "dist/chart-author.component.wasm", "--runtime", "dist/chart-runtime.component.wasm",
    "--music", music, "--contract", contractPath, "--audio", audio, "--out", bundle]);
  const verification = run(["verify", bundle, "--audio", audio]);
  assert.equal(verification.reproduced, true);
  assert.equal(verification.authenticity, false);
  const report = run(["analyze", bundle]);
  assert.equal(report.certificate.exact_within_model, true);
  const retained = report.candidates.filter(candidate => candidate.assessment.accepted);
  assert.ok(retained.length >= 2 && retained.length <= 16);
  assert.equal(report.distribution.retained_candidates, retained.length);
  const mass = report.distribution;
  assert.equal(
    BigInt(mass.retained_mass.numerator) * BigInt(mass.rejected_mass.denominator) * BigInt(mass.original_mass.denominator)
      + BigInt(mass.rejected_mass.numerator) * BigInt(mass.retained_mass.denominator) * BigInt(mass.original_mass.denominator),
    BigInt(mass.original_mass.numerator) * BigInt(mass.retained_mass.denominator) * BigInt(mass.rejected_mass.denominator),
  );
  const first = run(["generate", bundle, "--seed", seed, "--request-out", join(work, "request.bin")]);
  assert.deepEqual(run(["generate", bundle, "--seed", seed]), first);
  const selected = generated(first);
  const exportRoot = join(work, "ssc-export");
  const exported = run(["export-ssc", bundle, "--seed", seed, "--audio", audio,
    "--out", exportRoot, "--title", "Feedback Chart", "--artist", "PUMP"]);
  const replay = read(join(exportRoot, "replay.json"));
  const ssc = readFileSync(join(exportRoot, "chart.ssc"), "utf8");
  assert.deepEqual(exported.replay, replay);
  assert.equal(replay.schema_version, 2);
  assert.equal(replay.exporter_semantics, "pump-ssc-export-v2");
  assert.equal(replay.request.seed, seed);
  assert.equal(replay.selection.candidate_id, id(selected.candidate_id));
  assert.equal(replay.selection.program_sha256, id(selected.program_sha256));
  assert.equal(replay.selection.request_sha256, id(selected.request_sha256));
  assert.deepEqual(replay.chart, selected.chart);
  assert.deepEqual(replay.music, read(music));
  assert.equal(replay.signature_trust.status, "not_checked");
  assert.equal(replay.artifacts.ssc_sha256, digest(readFileSync(join(exportRoot, "chart.ssc"))));
  assert.equal(replay.artifacts.audio_sha256, digest(readFileSync(join(exportRoot, "music.wav"))));
  assert.deepEqual(readFileSync(join(exportRoot, "music.wav")), readFileSync(audio));
  assert.match(ssc, /#VERSION:0\.83;/);
  assert.match(ssc, /#STEPSTYPE:pump-double;/);
  assert.match(ssc, /#OFFSET:-0\.1;/);
  assert.match(ssc, /#BPMS:0=120,4=150;/);
  const preservedSsc = readFileSync(join(exportRoot, "chart.ssc"));
  reject(["export-ssc", bundle, "--seed", seed, "--audio", audio,
    "--out", exportRoot, "--title", "Replacement", "--artist", "PUMP"], /already exists|must not exist/);
  assert.deepEqual(readFileSync(join(exportRoot, "chart.ssc")), preservedSsc);
  const next = generated(run(["generate", bundle, "--seed", seed, "--history", id(selected.candidate_id)]));
  assert.notEqual(id(next.candidate_id), id(selected.candidate_id));
  assert.equal(next.allow_repeat_fallback, false);
  const history = retained.flatMap(candidate => ["--history", candidate.candidate_id]);
  const exhausted = generated(run(["generate", bundle, "--seed", seed, ...history]));
  assert.equal(exhausted.allow_repeat_fallback, true);
  const held = retained.find(candidate => candidate.assessment.difficulty.maximum.hold_occupancy > 0);
  assert.ok(held, "example must retain a chart containing holds");
  const otherIds = retained.filter(candidate => candidate !== held).flatMap(candidate => ["--history", candidate.candidate_id]);
  const heldChart = generated(run(["generate", bundle, "--seed", seed, ...otherIds])).chart;
  assert.ok(heldChart.notes.some(note => note.hold_ticks > 0));
  const explanation = run(["explain", bundle, "--seed", seed]);
  assert.ok(explanation.assessment);
  for (const [tick, micros] of [[0, 100000], [16, 2100000], [32, 3700000]]) {
    const scheduled = explanation.schedule.find(frame => frame.tick === tick);
    assert.ok(scheduled, `schedule missing tick ${tick}`);
    assert.equal(scheduled.song_time.negative, false);
    assert.equal(BigInt(scheduled.song_time.magnitude.numerator), BigInt(micros) * BigInt(scheduled.song_time.magnitude.denominator));
  }
  const sweep = run(["test-seeds", bundle, "--count", "32"]);
  assert.ok(sweep.varies);
  for (const fixture of ["contract-impossible.json", "contract-damaged-intent.json"]) {
    const failureReport = join(work, `${fixture}.failure.json`);
    const rejectedBundle = join(work, `${fixture}.bundle`);
    reject(["compile", "dist/chart-author.component.wasm", "--runtime", "dist/chart-runtime.component.wasm",
      "--music", music, "--contract", `dist/feedback/${fixture}`, "--out", rejectedBundle, "--failure-report", failureReport]);
    const failure = read(failureReport);
    assert.equal(failure.distribution.retained_candidates, 0);
    assert.ok(failure.candidates.every(candidate => candidate.assessment.rejections.length > 0));
    assert.equal(existsSync(rejectedBundle), false);
  }

  const profile = permissive();
  assert.deepEqual(evaluate(chart([tap(0, 1), tap(0, 4)]), profile), evaluate(chart([tap(0, 5)]), profile));
  const musical = chart([tap(0, 1), tap(4, 2), tap(8, 1), tap(12, 2)]);
  profile.intents = [rule("accent", { kind: "reference_accents", tolerance_ticks: 0 }, "shared", 4)];
  assert.equal(evaluate(musical, profile).accepted, true);
  const damaged = chart(musical.notes.filter(note => note.tick !== 4));
  const damageReport = evaluate(damaged, profile);
  assert.equal(damageReport.accepted, false);
  assert.ok(damageReport.rejections.some(rejection => rejection.kind === "intent_threshold"));
  profile.intents = ["first", "second"].map(name => rule(name, { kind: "reference_accents", tolerance_ticks: 0 }, "exclusive"));
  assert.equal(evaluate(chart([tap(0, 1), tap(4, 2)]), profile).accepted, true);
  assert.equal(evaluate(chart([tap(0, 1)]), profile).accepted, false);
  profile.intents.forEach(intent => { intent.credit_policy = "shared"; });
  assert.equal(evaluate(chart([tap(0, 1)]), profile).accepted, true);
  profile.intents = [rule("silence", { kind: "negative_space", start_tick: 4, end_tick: 8 })];
  assert.equal(evaluate(chart([]), profile).accepted, true);
  assert.equal(evaluate(chart([{ tick: 0, panel_mask: 4, hold_ticks: 8 }]), profile).accepted, false);
  profile.intents = [rule("motif", { kind: "relational_motif", minimum_notes: 2, mirror_equivalent: true }, "shared", 2)];
  const mirrored = chart([tap(0, 1), tap(4, 2), tap(8, 512), tap(12, 256)]);
  assert.equal(evaluate(mirrored, profile).intents.scores.relational_motifs, evaluate(musical, profile).intents.scores.relational_motifs);
  profile.intents = [];
  const impossible = evaluate(chart([tap(0, 31)]), profile);
  assert.equal(impossible.execution.feasible, false);
  assert.notEqual(impossible.execution.earliest_infeasible_frame, null);
  const anchored = [{ tick: 0, panel_mask: 1, hold_ticks: 4 }, { tick: 0, panel_mask: 16, hold_ticks: 8 }];
  assert.equal(evaluate(chart([...anchored, tap(4, 512)]), profile).execution.feasible, false);
  assert.equal(evaluate(chart([...anchored, tap(5, 512)]), profile).execution.feasible, true);
  profile.difficulty.total.maximum = 0;
  assert.ok(evaluate(musical, profile).rejections.some(rejection => rejection.kind === "difficulty_maximum"));
  const exhaustedBudget = permissive();
  exhaustedBudget.budgets.max_dp_work = 1;
  const exhaustedPath = join(work, "exhausted-contract.json");
  const musicalPath = join(work, "musical.json");
  save(exhaustedPath, exhaustedBudget);
  save(musicalPath, musical);
  reject(["evaluate", musicalPath, "--music", music, "--contract", exhaustedPath], /budget|work/);
  const invalidMusic = read(music);
  invalidMusic.tempo[0].micros_per_beat.denominator = 0;
  const invalidMusicPath = join(work, "invalid-music.json");
  save(invalidMusicPath, invalidMusic);
  reject(["compile", "dist/chart-author.component.wasm", "--runtime", "dist/chart-runtime.component.wasm",
    "--music", invalidMusicPath, "--contract", contractPath, "--out", join(work, "invalid-tempo")], /fraction|denominator|music|tempo/);
  const tinyLimits = read("dist/feedback/limits.json");
  tinyLimits.max_codec_bytes = 1;
  const tinyLimitsPath = join(work, "tiny-limits.json");
  save(tinyLimitsPath, tinyLimits);
  const tinyOutput = join(work, "unloadable.bundle");
  reject(["compile", "dist/chart-author.component.wasm", "--runtime", "dist/chart-runtime.component.wasm",
    "--music", music, "--contract", contractPath, "--limits", tinyLimitsPath, "--out", tinyOutput], /limit|codec|bytes/);
  assert.equal(existsSync(tinyOutput), false);

  const tampered = join(work, "tampered");
  cpSync(bundle, tampered, { recursive: true });
  const forgedReport = read(join(tampered, "report.json"));
  forgedReport.distribution.retained_candidates += 1;
  save(join(tampered, "report.json"), forgedReport);
  const manifest = read(join(tampered, "manifest.json"));
  manifest.files["report.json"] = digest(readFileSync(join(tampered, "report.json")));
  save(join(tampered, "manifest.json"), manifest);
  reject(["verify", tampered], /reproduced|report|certificate/);
  const privateKey = join(work, "private.key");
  const publicKey = join(work, "public.key");
  run(["keygen", "--private", privateKey, "--public", publicKey]);
  assert.equal(statSync(privateKey).mode & 0o777, 0o600);
  run(["sign", bundle, "--key", privateKey]);
  assert.equal(run(["verify", bundle, "--trusted-key", publicKey]).authenticity, true);
  const trustedExport = run(["export-ssc", bundle, "--seed", seed, "--audio", audio,
    "--out", join(work, "trusted-ssc-export"), "--title", "Trusted Feedback Chart",
    "--artist", "PUMP", "--trusted-key", publicKey]);
  assert.equal(trustedExport.replay.signature_trust.status, "trusted");
  assert.equal(trustedExport.replay.signature_trust.trusted_signer, readFileSync(publicKey, "utf8").trim());
  assert.equal(trustedExport.replay.source_manifest_sha256, digest(readFileSync(join(bundle, "manifest.json"))));
  assert.equal(run(["verify", bundle]).authenticity, false);
  const otherPublic = join(work, "other.pub");
  run(["keygen", "--private", join(work, "other.key"), "--public", otherPublic]);
  reject(["verify", bundle, "--trusted-key", otherPublic], /trusted|signature/);
  const signature = read(join(bundle, "signature.json"));
  signature.signature = "00".repeat(64);
  save(join(bundle, "signature.json"), signature);
  reject(["verify", bundle, "--trusted-key", publicKey], /signature/);
  const linked = join(work, "linked-signature");
  cpSync(tampered, linked, { recursive: true });
  cpSync(join(bundle, "report.json"), join(linked, "report.json"));
  cpSync(join(bundle, "manifest.json"), join(linked, "manifest.json"));
  const sentinel = join(work, "sentinel");
  writeFileSync(sentinel, "must survive");
  symlinkSync(sentinel, join(linked, "signature.json"));
  reject(["sign", linked, "--key", privateKey]);
  assert.equal(readFileSync(sentinel, "utf8"), "must survive");
  const wrongAudio = join(work, "wrong.wav");
  writeFileSync(wrongAudio, "not the bound audio");
  reject(["verify", bundle, "--audio", wrongAudio], /audio/);
  const rejectedExport = join(work, "wrong-audio-export");
  reject(["export-ssc", bundle, "--seed", seed, "--audio", wrongAudio,
    "--out", rejectedExport, "--title", "Rejected", "--artist", "PUMP"], /audio/);
  assert.equal(existsSync(rejectedExport), false);
  reject(["generate", bundle, "--seed", "bad"], /seed/);
  console.log(JSON.stringify({ feedback_v2: "passed", retained_candidates: retained.length, seed_variants: sweep.unique_candidates, audio_digest: audioInfo.audio_digest }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
