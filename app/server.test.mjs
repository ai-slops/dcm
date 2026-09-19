import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { server } from "./server.mjs";

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test("health exposes the compiled-chart service contract", async () => {
  const response = await fetch(`${base}/health`);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.mode, "pump-double-10");
  assert.equal(typeof result.ready, "boolean");
});

test("malformed seeds are rejected before spawning a generator", async () => {
  const response = await fetch(`${base}/api/generate?seed=../../etc/passwd`);
  assert.equal(response.status, 400);
});

test("mutating requests are rejected", async () => {
  const response = await fetch(`${base}/api/generate`, { method: "POST" });
  assert.equal(response.status, 405);
});

test("arbitrary file routes are unavailable", async () => {
  const response = await fetch(`${base}/manifest.json`);
  assert.equal(response.status, 404);
});
