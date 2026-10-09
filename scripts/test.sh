#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

./scripts/build.sh
./scripts/test-packages.sh
./scripts/test-store.sh
node scripts/test-chart-v2.mjs
node scripts/test-package-feedback.mjs
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
seed0="0000000000000000000000000000000000000000000000000000000000000000"
seed1="0101010101010101010101010101010101010101010101010101010101010101"

dist/pump compile dist/author.component.wasm --runtime dist/runtime.component.wasm --out "$work/bundle" --format json
dist/pump generate "$work/bundle" --seed "$seed0" --format json >"$work/a.json"
dist/pump generate "$work/bundle" --seed "$seed0" --format json >"$work/b.json"
cmp "$work/a.json" "$work/b.json"
dist/pump generate "$work/bundle" --seed "$seed1" --format json >"$work/c.json"
node --input-type=module - "$work/a.json" "$work/c.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const traces = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
assert.equal(traces[0].plan_digest, '9cbc36bc39973eeda592d28b031cc0918dda575d036e59955de633ba4b8ef08a');
assert.equal(traces[0].generated_chart_digest, '616144e825965978dc2ceb4e5d3d588f950da611318271168a649985b8cb2fad');
assert.notDeepEqual(traces[0].commands, traces[1].commands);
JS
dist/pump test-seeds "$work/bundle" --count 32 --format json
PUMP_BUNDLE="$work/bundle" node --test app/server.test.mjs
if dist/pump generate "$work/bundle" --seed invalid --format json; then exit 1; fi
printf x >>"$work/bundle/runtime-plan.bin"
if dist/pump verify "$work/bundle" --format json; then exit 1; fi
if dist/pump compile dist/author.component.wasm --runtime dist/author.component.wasm --out "$work/rejected" --format json; then exit 1; fi
