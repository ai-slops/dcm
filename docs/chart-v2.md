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

## StepMania and OutFox SSC export

Export one verified runtime selection as a self-contained pump-double song directory:

```sh
pump chart export-ssc chart.bundle \
  --seed 0000000000000000000000000000000000000000000000000000000000000000 \
  --audio /path/to/music.wav --out exported-song \
  --title "Example" --artist "Artist"
```

Repeat `--history <64-hex-candidate-id>` exactly as for `generate`. Supply
`--trusted-key release.pub` to require the bundle's Ed25519 signature to match that explicit trust
anchor. Without it, bundle hashes and full evaluation reproduction are still checked, but
`replay.json` records signature trust as `not_checked`. The export is not itself signed.

The output directory must not exist. Every input, chart constraint, digest, signature (when
requested), runtime result, and rendered size is validated before the directory is created. The
fixed output set is `chart.ssc`, `replay.json`, and `music.wav`, `music.ogg`, or `music.mp3` based on
the verified source extension. Audio bytes are read once, checked against the bundle's bound
SHA-256, then those same bytes are written; the exporter does not claim to decode or validate the
audio codec. Audio inputs are limited to 32 MiB, matching the bundle artifact read limit.

`replay.json` schema 2 records the `pump-ssc-export-v2` semantics version, canonical seed and
history, selected candidate and runtime/request digests, selection ratios and fallback result,
the exact generated `Chart` and bound `Music`, source manifest hash, SSC/audio names and hashes,
and signature trust result. Signature verification and that source hash use the same manifest byte
snapshot that bundle loading validated. The SSC uses version 0.83, `pump-double`, `Edit`, meter 1,
and ten lanes in project panel-bit order: left
`DL UL C UR DR`, then right `DL UL C UR DR`. User title and artist fields are ASCII-only, at most
256 bytes, escape SSC delimiters and backslashes, and reject line controls and `//` comment starts.

The supported profile writes all measures at 192 rows, or 48 rows per beat. Every note head, hold
tail, and tempo change must lie exactly on that grid. A cell that would need both a hold tail and a
new tap or hold head is rejected rather than changed. BPM and beat tags must have an exact
terminating decimal of at most six fractional digits; BPM is limited to 1000, tempo positions to
beat 1,000,000, offsets to 24 hours, and the SSC file to 32 MiB. Positive source
`offset_micros`, where `song_time = offset + elapsed`, is negated for SSC `#OFFSET`. Metadata and
timing are never silently rounded.

SSC note rows and timing tags preserve every representable note onset, hold tail, panel, tempo
change, and offset. SSC rows do not encode an exact trailing rest or a chart span ending inside an
otherwise empty measure. The replay descriptor preserves the exact chart span, music duration,
grid, notes, and timing map, so the complete export package remains reversible even when two exact
charts have identical SSC note rows. StepMania and OutFox parse timing decimals into their engine
numeric representation, so runtime floating-point timing is not a claim of mathematical
exactness. Stops, delays, warps, rolls, mines, keysounds, attacks, arbitrary subdivisions,
calibrated meter values, and formats beyond WAV/OGG/MP3 byte binding are outside this exporter.

## Exporting an edited chart

For a chart edited outside a verified bundle, use the separate native command:

```sh
just pump chart export-edited-ssc draft-chart.json \
  --music music.json --audio music.wav --out edited-song \
  --title "Edited chart" --artist "Author"
```

It normalizes the chart, checks its grid/span against Music, verifies the bound audio bytes, and
uses the same exact SSC renderer and rejection profile as verified export. It writes `chart.ssc`,
`music.wav`/`music.ogg`/`music.mp3`, and `edited-export.json` into a new directory. The descriptor
contains the exact chart/music and artifact hashes but explicitly records `source: "user_edited"`
and `certification.status: "none"`. It contains no source-manifest, candidate, signature, or
evaluation claims. Run `chart evaluate` separately for a finite-model assessment. The
[web studio](studio.md) uses this command for its SSC ZIP downloads.

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
