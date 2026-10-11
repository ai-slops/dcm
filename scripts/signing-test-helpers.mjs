import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";

const pkcs8Ed25519SeedPrefix = Buffer.from("302e020100300506032b657004220420", "hex");

export function writeSigningKeyFixture(privatePath, publicPath, seedByte = 7) {
  const seed = Buffer.alloc(32, seedByte);
  const privateKey = createPrivateKey({
    key: Buffer.concat([pkcs8Ed25519SeedPrefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  writeFileSync(privatePath, seed, { flag: "wx" });
  writeFileSync(publicPath, `${publicDer.subarray(-32).toString("hex")}\n`, { flag: "wx" });
}

export function useWindowsSigningKeyFixture(keygenResult, privatePath, publicPath) {
  assert.equal(keygenResult.status, 1, keygenResult.stderr);
  const error = JSON.parse(keygenResult.stderr);
  assert.equal(error.ok, false);
  assert.match(error.error, /permission enforcement is unsupported/);
  assert.deepEqual([existsSync(privatePath), existsSync(publicPath)], [false, false]);
  writeSigningKeyFixture(privatePath, publicPath);
}

export function createSymlinkFixture(target, path, label) {
  try {
    symlinkSync(target, path);
    return true;
  } catch (error) {
    const unsupported = process.platform === "win32"
      && ["EPERM", "EACCES", "ENOSYS"].includes(error.code);
    if (!unsupported) throw error;
    process.stderr.write(`SKIP ${label}: Windows symlink creation is unavailable (${error.code})\n`);
    return false;
  }
}
