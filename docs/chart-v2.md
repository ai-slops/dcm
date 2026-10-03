# Feedback-grade chart bundles

Chart v2 is an additive pipeline selected with `pump chart`. It does not reinterpret or modify
v1 bundles, package locks, runtime plans, or generation behavior.

## Build artifacts

The v2 author imports only `pump:chart/plan-builder@0.2.0`. The host parses `Music` from JSON,
owns the bounded node arena, and receives only resource operations from the author. The v2 runtime
has no imports and exports `generate(program-bytes, request-bytes)`.

Build the component core modules and wrap them with the component encoder:

```sh
cargo build --locked --release --target wasm32-unknown-unknown \
  -p pump-chart-author-component -p pump-chart-runtime-component
wasm-tools component new \
  target/wasm32-unknown-unknown/release/pump_chart_author_component.wasm \
  -o dist/chart-author.component.wasm
wasm-tools component new \
  target/wasm32-unknown-unknown/release/pump_chart_runtime_component.wasm \
  -o dist/chart-runtime.component.wasm
```

## Compile and generate

The example pins the SHA-256 of a deterministic WAV in `music.json`. The audio is verified at compile
time but is not copied into the bundle or loaded by the runtime.

```sh
node scripts/make-feedback-audio.mjs /tmp/feedback.wav
pump chart compile dist/chart-author.component.wasm \
  --runtime dist/chart-runtime.component.wasm \
  --music examples/feedback/music.json \
  --audio /tmp/feedback.wav \
  --contract examples/feedback/contract.json \
  --limits examples/feedback/limits.json \
  --out chart.bundle --format json

pump chart generate chart.bundle \
  --seed 0000000000000000000000000000000000000000000000000000000000000000 \
  --request-out replay.request --format json
pump chart analyze chart.bundle --format json
pump chart explain chart.bundle \
  --seed 0101010101010101010101010101010101010101010101010101010101010101 \
  --format json
pump chart test-seeds chart.bundle --count 64 --format json
pump chart verify chart.bundle --audio /tmp/feedback.wav --format json
pump chart evaluate input-chart.json \
  --music examples/feedback/music.json \
  --contract examples/feedback/contract.json --format json
```

Pass prior candidate IDs in order with repeated `--history <64-hex-id>` options. The configured
recent window excludes those candidates. If that excludes every candidate, generation samples the
complete distribution and sets `allow_repeat_fallback` to `true`; the seed is never redrawn.

## Integrity, reproduction, and signatures

Schema 2 pins the exact author component, canonical Plan, limits, evaluation contract, runtime
program, runtime component, and compile report. Verification strictly decodes these artifacts,
re-enumerates every derivation, re-evaluates every concrete candidate, rebuilds the weights, and
requires the reproduced runtime program and report to be equal to the bundled values.

Every runtime response is also compared in full with the native reference selector for the same
program and request. This covers the selected chart, digests, probability ratios, eligible weight,
and history-fallback flag, rather than merely checking candidate membership. The certificate
covers the finite candidate data and declared model; it is not a proof that arbitrary supplied
WASM code terminates on every input. Runtime traps and budget exhaustion remain explicit failures.

An unsigned bundle can prove integrity and reproducibility, not publisher authenticity. Generate a
key only on a trusted host. The private file is created with create-new semantics and mode `0600`:

```sh
pump chart keygen --private release.key --public release.pub
pump chart sign chart.bundle --key release.key
pump chart verify chart.bundle --trusted-key release.pub
```

Signing covers the exact manifest bytes with the `pump.chart.bundle.manifest.v2` domain. The public
key recorded with the signature is informational. `authenticity` becomes true only when the caller
supplies a matching trusted key as a file or 32-byte hexadecimal value.

## Claims and failure fixtures

The certificate is exact only within the declared finite contact, timing, difficulty, intent, and
enumeration models. It is not an official PUMP rating, ranked-play approval, universal safety
claim, subjective artistry score, or calibrated execution probability.

`examples/feedback/contract-damaged-intent.json` requires deliberately unattainable intent credit.
`contract-impossible.json` demands an impossible difficulty envelope. `corrupted.plan` is malformed
codec input. These fixtures are intended for negative CLI and bundle-tampering tests.
