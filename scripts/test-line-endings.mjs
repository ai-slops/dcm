import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "pump-autocrlf-"));
const repository = join(work, "repository");
const checkout = join(work, "checkout");
const source = Buffer.from("first line\nsecond line\n");
const binary = Buffer.from("binary fixture\r\nwithout a NUL\r\n");
const textFiles = ["Dockerfile", "justfile", "Cargo.lock", "src/lib.rs", "scripts/build.sh", ".dim/repos.yml"];
const binaryFiles = ["fixture.bin", "fixture.wasm", "fixture.wav", "fixture.plan", "fixture.program"];

function git(...args) {
  const result = spawnSync("git", ["-c", "core.autocrlf=true", "-c", "core.eol=crlf", ...args], {
    cwd: repository, encoding: "utf8", timeout: 30000,
    env: { ...process.env, GIT_MASTER: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

try {
  mkdirSync(repository);
  mkdirSync(checkout);
  copyFileSync(join(root, ".gitattributes"), join(repository, ".gitattributes"));
  for (const file of [...textFiles, ...binaryFiles]) {
    const path = join(repository, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, textFiles.includes(file) ? source : binary);
  }
  git("init", "--quiet");
  git("add", ".");
  git("checkout-index", "--all", `--prefix=${checkout}/`);
  for (const file of textFiles) assert.deepEqual(readFileSync(join(checkout, file)), source, file);
  for (const file of binaryFiles) assert.deepEqual(readFileSync(join(checkout, file)), binary, file);
  console.log(JSON.stringify({ line_endings: "passed", autocrlf: true, core_eol: "crlf", text_files: textFiles.length, binary_files: binaryFiles.length }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
