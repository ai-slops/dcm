#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
seed="0000000000000000000000000000000000000000000000000000000000000000"

expect_failure() {
  expected="$1"
  shift
  if "$@" 2>"$work/error.json"; then exit 1; fi
  node --input-type=module - "$work/error.json" "$expected" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const error = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(error.ok, false);
assert.ok(error.error.includes(process.argv[3]), error.error);
JS
}

mkdir "$work/source"
cp dist/song-a.package.json dist/song-b.package.json dist/song-a.component.wasm dist/song-b.component.wasm dist/pattern.component.wasm dist/style-calm.component.wasm dist/style-bold.component.wasm "$work/source/"
for song in a b; do
  dist/pump package resolve "$work/source/song-$song.package.json" --out "$work/$song.lock" --format json
done
node --input-type=module - "$work/a.lock" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
writeFileSync(path, `${JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))}\n\n`);
JS
for song in a b; do
  dist/pump package cache "$work/source/song-$song.package.json" --lock "$work/$song.lock" --store "$work/store" --format json
  dist/pump package compile "$work/source/song-$song.package.json" --lock "$work/$song.lock" --runtime dist/runtime.component.wasm --out "$work/source-$song.bundle" --format json
done
dist/pump package cache "$work/source/song-a.package.json" --lock "$work/a.lock" --store "$work/store" --format json
node --input-type=module - "$work/store/blobs/sha256" <<'JS'
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const blobs = readdirSync(process.argv[2]);
assert.equal(blobs.length, 5);
assert.ok(blobs.every(name => /^[0-9a-f]{64}$/.test(name)));
JS
printf x >>"$work/source/pattern.component.wasm"
expect_failure 'package lock does not exactly match source artifacts' dist/pump package cache "$work/source/song-a.package.json" --lock "$work/a.lock" --store "$work/store" --format json
rm -rf "$work/source"

for song in a b; do
  dist/pump package compile-locked "$work/$song.lock" --store "$work/store" --runtime dist/runtime.component.wasm --out "$work/cached-$song.bundle" --format json
  diff -r "$work/source-$song.bundle" "$work/cached-$song.bundle"
  dist/pump generate "$work/source-$song.bundle" --seed "$seed" --format json >"$work/source-$song.json"
  dist/pump generate "$work/cached-$song.bundle" --seed "$seed" --format json >"$work/cached-$song.json"
  cmp "$work/source-$song.json" "$work/cached-$song.json"
done

expect_failure 'inspect store directory' dist/pump package compile-locked "$work/a.lock" --store "$work/absent" --runtime dist/runtime.component.wasm --out "$work/rejected-missing" --format json
blob="$(node --input-type=module - "$work/a.lock" <<'JS'
import { readFileSync } from 'node:fs';
console.log(JSON.parse(readFileSync(process.argv[2], 'utf8')).packages.find(entry => entry.key === 'pattern').sha256);
JS
)"
mv "$work/store/blobs/sha256/$blob" "$work/saved-blob"
expect_failure 'load locked package pattern' dist/pump package compile-locked "$work/a.lock" --store "$work/store" --runtime dist/runtime.component.wasm --out "$work/rejected-blob-missing" --format json
mv "$work/saved-blob" "$work/store/blobs/sha256/$blob"
printf x >>"$work/store/blobs/sha256/$blob"
expect_failure 'stored blob digest mismatch' dist/pump package compile-locked "$work/a.lock" --store "$work/store" --runtime dist/runtime.component.wasm --out "$work/rejected-corrupt" --format json
