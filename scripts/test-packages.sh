#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
seed="0000000000000000000000000000000000000000000000000000000000000000"

mkdir "$work/a" "$work/b"
cp dist/song-a.package.json "$work/a/pump.package.json"
cp dist/song-a.component.wasm dist/pattern.component.wasm dist/style-calm.component.wasm "$work/a/"
cp dist/song-b.package.json "$work/b/pump.package.json"
cp dist/song-b.component.wasm dist/pattern.component.wasm dist/style-bold.component.wasm "$work/b/"

dist/pump package resolve "$work/a/pump.package.json" --out "$work/a.lock" --format json
dist/pump package resolve "$work/b/pump.package.json" --out "$work/b.lock" --format json
node --input-type=module - "$work/a.lock" "$work/b.lock" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const locks = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const pick = (lock, key) => lock.packages.find(entry => entry.key === key).sha256;
assert.equal(pick(locks[0], 'pattern'), pick(locks[1], 'pattern'));
assert.notEqual(pick(locks[0], 'style'), pick(locks[1], 'style'));
JS

dist/pump package compile "$work/a/pump.package.json" --lock "$work/a.lock" --runtime dist/runtime.component.wasm --out "$work/bundle-a" --format json
dist/pump package compile "$work/b/pump.package.json" --lock "$work/b.lock" --runtime dist/runtime.component.wasm --out "$work/bundle-b" --format json
dist/pump package compatible "$work/a.lock" "$work/b.lock" --key pattern --format json
dist/pump verify "$work/bundle-a" --format json
dist/pump verify "$work/bundle-b" --format json
node --input-type=module - "$work/bundle-a/invocations.json" "$work/bundle-b/invocations.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const reports = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const policy = report => report.invocations.find(entry => entry.style_policy).style_policy;
assert.deepEqual(policy(reports[0]), {primary_weight: 5, variation_weight: 1, allow_mirror: false});
assert.deepEqual(policy(reports[1]), {primary_weight: 2, variation_weight: 5, allow_mirror: true});
assert.equal(reports[0].invocations.filter(entry => entry.package_key === 'pattern').length, 1);
assert.equal(reports[1].invocations.filter(entry => entry.package_key === 'pattern').length, 2);
JS

rm -rf "$work/a" "$work/b"
dist/pump generate "$work/bundle-a" --seed "$seed" --format json >"$work/a.json"
dist/pump generate "$work/bundle-b" --seed "$seed" --format json >"$work/b.json"
node --input-type=module - "$work/a.json" "$work/b.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const charts = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
assert.notDeepEqual(charts[0].commands, charts[1].commands);
JS

mkdir "$work/tamper"
cp dist/song-a.package.json "$work/tamper/pump.package.json"
cp dist/song-a.component.wasm dist/pattern.component.wasm dist/style-calm.component.wasm "$work/tamper/"
printf x >>"$work/tamper/pattern.component.wasm"
if dist/pump package compile "$work/tamper/pump.package.json" --lock "$work/a.lock" --runtime dist/runtime.component.wasm --out "$work/rejected-tamper" --format json; then exit 1; fi
if dist/pump package compile "$work/tamper/pump.package.json" --lock "$work/b.lock" --runtime dist/runtime.component.wasm --out "$work/rejected-lock" --format json; then exit 1; fi

mkdir "$work/failure"
cp dist/song-a.package.json "$work/failure/pump.package.json"
cp dist/fixture-pattern-failure.component.wasm "$work/failure/pattern.component.wasm"
cp dist/fixture-song-recovery.component.wasm "$work/failure/song-a.component.wasm"
cp dist/style-calm.component.wasm "$work/failure/"
dist/pump package resolve "$work/failure/pump.package.json" --out "$work/failure.lock" --format json
if dist/pump package compile "$work/failure/pump.package.json" --lock "$work/failure.lock" --runtime dist/runtime.component.wasm --out "$work/rejected-poison" --format json 2>"$work/poison.json"; then exit 1; fi
node --input-type=module - "$work/poison.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const error = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(error.ok, false);
assert.match(error.error, /builder session is poisoned/);
JS
