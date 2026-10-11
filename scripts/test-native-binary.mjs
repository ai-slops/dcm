import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePumpBinary } from "./pump-binary.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("uses pump.exe for the Windows host default", () => {
  assert.equal(resolvePumpBinary("win32", {}), join(repoRoot, "dist/pump.exe"));
});

test("uses pump for a non-Windows host default", () => {
  assert.equal(resolvePumpBinary("linux", {}), join(repoRoot, "dist/pump"));
});

test("preserves an explicit binary override on every host", () => {
  const override = "fixture directory/pump custom.exe";
  assert.equal(resolvePumpBinary("linux", { PUMP_BINARY: override }), resolve(override));
  assert.equal(resolvePumpBinary("win32", { PUMP_BINARY: override }), resolve(override));
});
