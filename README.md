# PUMP component chart compiler

This repository implements a deterministic procedural chart pipeline for a ten-panel PUMP layout, including local reusable song, pattern, and style packages. Untrusted Rust components build a bounded plan only through host-owned WIT resources. The host validates and compiles that plan into a versioned binary `RuntimePlan`. A separate import-free runtime WebAssembly component expands it into a deterministic `CommandTrace`.

## Build

Docker is the build prerequisite. Node.js 24 is also required for the DIM gateway and its end-to-end tests; DIM already provides it. The build pins Rust 1.94.0, Wasmtime 40.0.4, `wit-bindgen` 0.53.1, `wasm-tools` 1.254.0, and the build/runtime image digests. The extracted CLI runs on Linux with glibc 2.36 or newer, using the Docker host's architecture.

```sh
./scripts/build.sh
./dist/pump --help
```

The build emits:

- `dist/pump`
- `dist/author.component.wasm`
- `dist/runtime.component.wasm`
- reusable package examples: one pattern, two songs, two styles, and two source manifests
- `dist/chart-author.component.wasm`, `dist/chart-runtime.component.wasm`, and `dist/feedback/` for the additive v2 pipeline

## Feedback-grade v2 workflow

Use `pump chart` for holds/rests, exact musical timing, two-foot execution paths, intent evidence,
rule-based difficulty, exhaustive finite-candidate certification, history-aware generation, and
optional trusted Ed25519 signatures. The original commands below continue to use v1 unchanged.

```sh
demo="$(mktemp -d)"
node scripts/make-feedback-audio.mjs "$demo/music.wav"
./dist/pump chart compile dist/chart-author.component.wasm \
  --runtime dist/chart-runtime.component.wasm \
  --music dist/feedback/music.json --audio "$demo/music.wav" \
  --contract dist/feedback/contract.json --out "$demo/chart.bundle" --format json
./dist/pump chart analyze "$demo/chart.bundle" --format json
./dist/pump chart explain "$demo/chart.bundle" \
  --seed 0000000000000000000000000000000000000000000000000000000000000000 --format json
./dist/pump chart verify "$demo/chart.bundle" --audio "$demo/music.wav" --format json
./dist/pump chart keygen --private "$demo/release.key" --public "$demo/release.pub"
./dist/pump chart sign "$demo/chart.bundle" --key "$demo/release.key"
./dist/pump chart verify "$demo/chart.bundle" --trusted-key "$demo/release.pub" --format json
```

The example has a real four-second metronome, a 100 ms offset, and a 120-to-150 BPM change.
`explain` exposes exact song times and an execution witness. `evaluate` accepts a concrete chart
for direct damaged-pattern or impossible-movement feedback. `compile --failure-report <path>`
retains structured counterexamples when every candidate fails. `analyze` supplies hexadecimal
candidate IDs for repeated `generate --history <id>` options.

See [v2 CLI and bundles](docs/chart-v2.md), [evaluation model and units](docs/evaluation-v2.md),
and [verification evidence](docs/verification.md). These are exact results within a declared,
bounded rule model, not official PUMP ratings or guarantees of human safety.

## End-to-end quickstart

```sh
./dist/pump component inspect dist/runtime.component.wasm --format json
./dist/pump compile dist/author.component.wasm \
  --runtime dist/runtime.component.wasm --out bundle --format json
./dist/pump generate bundle \
  --seed 0000000000000000000000000000000000000000000000000000000000000000 \
  --format json
./dist/pump analyze bundle --format json
./dist/pump verify bundle --format json
./dist/pump test-seeds bundle --count 32 --format json
./dist/pump explain bundle \
  --seed 0101010101010101010101010101010101010101010101010101010101010101 \
  --format json
```

`generate` invokes the bundled runtime component in Wasmtime. It does not use the native generator as a fallback. The author receives no serialized-plan input path; it can only call the bounded host resource.

Run all automated and adversarial scenarios with `./scripts/test.sh`. It rebuilds first to prevent stale artifacts from passing tests. Build-time checks include Rust formatting, Clippy, and the workspace test suite. See [semantics](docs/semantics.md), [architecture](docs/architecture.md), and [implementation status](docs/status.md).

The output bundle directory must not already exist. Compiling a second bundle with the same inputs produces identical artifact bytes. The bundled example produces 52 tap commands; compare `commands`, not replay metadata, when measuring chart variation.

## Local package composition

```sh
./dist/pump package resolve dist/song-a.package.json --out song-a.lock.json
./dist/pump package compile dist/song-a.package.json \
  --lock song-a.lock.json --runtime dist/runtime.component.wasm --out song-a.bundle
./dist/pump generate song-a.bundle \
  --seed 0000000000000000000000000000000000000000000000000000000000000000
```

`song-a.package.json` and `song-b.package.json` use the same locked pattern component and different locked style components. Source-based compilation checks the source files against the lock; generation and verification use only the completed bundle. See [local package format](docs/package-format.md).

Retain those source artifacts in a local digest store before removing them:

```sh
./dist/pump package cache dist/song-a.package.json \
  --lock song-a.lock.json --store .pump-store
./dist/pump package compile-locked song-a.lock.json \
  --store .pump-store --runtime dist/runtime.component.wasm --out restored-song-a.bundle
```

`compile-locked` does not read the source manifest or original song/pattern/style files. It verifies every stored component against its locked SHA-256 and uses the same compiler. With the same exact lock bytes and runtime component, the resulting bundle is byte-identical to source-based compilation. The runtime component remains an explicit input. See [artifact store](docs/artifact-store.md) for layout and filesystem trust limits.

Existing packages can also enter the feedback-grade v2 pipeline without rewriting their components:

```sh
./dist/pump chart compile-package dist/song-a.package.json --lock song-a.lock.json \
  --runtime dist/chart-runtime.component.wasm \
  --music dist/package-feedback/song-a.music.json \
  --contract dist/package-feedback/contract.json --out package-feedback.bundle
```

Use `chart compile-locked <lock> --store <store>` with the same feedback inputs for source-free
compilation. The bridge preserves v1 timing, correlated choice outcomes, and exact nominal priors;
the new bundle uses v2 seed mapping. Source Plan and package provenance are retained and verified.
See [package feedback workflow](docs/package-feedback.md).

## DIM gateway

`.dim/` is preserved unchanged. Its existing launcher invokes the rewritten `app/server.mjs` on port 3000. The gateway has no editing UI and no arbitrary shell/path endpoint.

```sh
node app/server.mjs
curl http://localhost:3000/health
curl 'http://localhost:3000/api/generate?seed=0000000000000000000000000000000000000000000000000000000000000000'
```

Generation uses `dist/pump` and `bundle/` from the quickstart. An operator may set `PUMP_BUNDLE` to another bundle path. Before artifacts are built, the service remains available with `ready: false`, and generation returns HTTP 503. Invalid seeds return HTTP 400. At most two generation subprocesses run concurrently, with a 30-second deadline.

## Security boundary

The host links no WASI interfaces. Components run synchronously with fuel, one memory capped at 64 MiB, instance/table limits, and a hostcall budget. Threads, shared memory, SIMD, and relaxed SIMD are unavailable. Hashes alone provide integrity, not publisher authenticity; v2 signature verification requires an explicitly supplied trusted public key. The existing HTTP gateway remains a v1 development service, not an authenticated public generation service. V2 is exposed through the `pump chart` CLI.

The six feedback domains are implemented in the finite v2 profile. Network/transitive package resolution, generic Plan-fragment caches, empirical difficulty calibration, full biomechanics, production game-engine integration, and official ranked policy remain separate work. Structural validity alone is not physical feasibility; v2 evaluates the explicitly declared contact model.
