import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pump = resolve(root, "dist", process.platform === "win32" ? "pump.exe" : "pump");
const files = process.argv.slice(2);
if (files.length === 0) files.push(".local/references/ucs/CS306.ucs", ".local/references/ucs/CS349.ucs");
const expected = {
  "CS306.ucs": { hash: "778b5423bed47a14b57d729cc213d78caa6e867ce62ca0f9177d46d86dc34bb4", mode: "Double", grid: 8, span: 386, notes: 138 },
  "CS349.ucs": { hash: "63987764694f89da70a502159c18fd1c34bde4577fd8345f64431a926b08a466", mode: "Single", grid: 4, span: 1528, notes: 63 },
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const gcd = (a, b) => b === 0n ? a : gcd(b, a % b);
function add(left, right) {
  const numerator = left[0] * right[1] + right[0] * left[1];
  const denominator = left[1] * right[1];
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}
function songTime(music, tick) {
  let result = [BigInt(music.offset_micros), 1n];
  for (const [index, segment] of music.tempo.entries()) {
    const end = Math.min(tick, music.tempo[index + 1]?.start_tick ?? music.duration_ticks);
    if (end <= segment.start_tick) break;
    result = add(result, [BigInt(end - segment.start_tick) * BigInt(segment.micros_per_beat.numerator), BigInt(music.ticks_per_beat) * BigInt(segment.micros_per_beat.denominator)]);
  }
  return result;
}
function run(args) {
  const result = spawnSync(pump, [...args, "--format", "json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

const work = mkdtempSync(join(tmpdir(), "pump-ucs-reference-"));
try {
  for (const [index, input] of files.entries()) {
    const path = resolve(input);
    const bytes = readFileSync(path);
    const hash = digest(bytes);
    const known = expected[basename(path)];
    const parsed = run(["chart", "import-ucs", path]);
    if (known) {
      assert.equal(hash, known.hash);
      assert.equal(parsed.mode, known.mode);
      assert.equal(parsed.chart.ticks_per_beat, known.grid);
      assert.equal(parsed.chart.span_ticks, known.span);
      assert.equal(parsed.chart.notes.length, known.notes);
      assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
      assert.ok(bytes.every(byte => byte < 0x80));
      assert.equal(bytes.toString("ascii").replaceAll("\r\n", "").includes("\n"), false);
    }
    if (basename(path) === "CS306.ucs") assert.deepEqual(songTime(parsed.music, 64), [4_090_000n, 1n]);
    if (basename(path) === "CS349.ucs") {
      const firstTime = [150n, 151n, 152n, 153n].reduce((time, bpm) => add(time, [240_000_000n, bpm]), [20_000n, 1n]);
      assert.deepEqual(songTime(parsed.music, 64), firstTime);
    }
    const chart = join(work, `${index}-chart.json`);
    const music = join(work, `${index}-music.json`);
    const output = join(work, `${index}-roundtrip.ucs`);
    writeFileSync(chart, JSON.stringify(parsed.chart));
    writeFileSync(music, JSON.stringify(parsed.music));
    run(["chart", "export-ucs", chart, "--music", music, "--mode", parsed.mode, "--out", output]);
    const reparsed = run(["chart", "import-ucs", output]);
    assert.deepEqual(reparsed, parsed);
    assert.equal(digest(readFileSync(path)), hash);
    console.log(JSON.stringify({ file: basename(path), sha256: hash, mode: parsed.mode, ticks_per_beat: parsed.chart.ticks_per_beat, span_ticks: parsed.chart.span_ticks, notes: parsed.chart.notes.length, roundtrip: "passed", original_bytes: "unchanged" }));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
