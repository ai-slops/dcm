# Verification record

Verified in this workspace natively on x86-64 Linux with Rust 1.94.0 and wasm-tools 1.254.0.
Docker is optional, not part of the default gate. Physical Windows/MSVC, ARM64, macOS, console
hosts, and production game engines were not tested.

## Automated checks

`just test` (`sh scripts/test.sh`) validates current sources rather than reusing stale `dist`
files. It tests Git checkout behavior with `core.autocrlf=true` and `core.eol=crlf`, host binary
resolution, and native build/dispatch behavior, then runs `scripts/check.sh` on the host:

- `cargo fmt --all -- --check`
- `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`
- `cargo test --locked --workspace`: 168 tests passed (62 CLI/host tests, 16 bridge tests, 32 v2 core tests, 28 evaluator tests, and 30 preserved v1 core tests).

The separate `scripts/build.sh` then produces release builds of the CLI and WASM guests, followed
by componentization. `just build` does not execute fmt, Clippy, or tests. `just check` runs only
the Rust checks above, and `just test-e2e` runs the integration scenarios against existing `dist`.
The original full gate is preserved; only the ordinary build no longer depends on lint/test success.

The end-to-end script runs the actual author and runtime through Wasmtime. It checks identical output for repeated requests, compares actual command arrays across seeds, exercises the gateway against a real bundle, and rejects malformed seeds, modified artifacts, and runtime components with imports. All five Node gateway tests passed, including successful WASM-backed generation.

The example's 32-seed sweep produced **four distinct command traces**, not 32: replay metadata must not be counted as musical variation. Its repeated/mirrored phrase deliberately shares some draws, so there are only four possible combinations in this example.

## Boundaries exercised

- Invalid/empty/out-of-range panel masks, zero duration, arithmetic overflow.
- Forward references, duplicate semantic IDs, forged cached metadata.
- Invalid versions, trailing bytes, malformed trace digests/order/collisions.
- Depth, edge, individual string, total string, and expansion bounds.
- Shared-DAG validation without exponential path traversal.
- Literal PRF vectors, actual command diversity, mirror involution, repeat occurrences.
- Infinite guest loop fuel exhaustion and multiple-memory rejection.
- One author builder per session, forbidden runtime imports, missing runtime ABI.
- Bundle digest mismatch and HTTP input/method/route rejection.

## Package extension

The package extension additionally verifies two songs sharing one external pattern digest with distinct style digests, persisted policy weights, source-independent replay, and exact lock rejection after source modification. A test-only pattern mutates the shared builder and returns an error; a test-only song deliberately ignores that error and attempts to finish. The real component compiler rejects the resulting poisoned session. Recreating a finished builder, invalid-root hostcall accounting, failed-child fuel accounting, symlink escape, export-name misuse, and uninvoked incompatible leaf signatures have focused regression tests.

Package compilation pins its separate fuel/memory/registry policy without changing the stage-1 compiler-policy digest or runtime ABI. Public-contract compatibility checks accept changed implementation digests only when the locked public contract matches; they do not prove musical equivalence.

## Artifact store

The store extension adds nine filesystem regression tests. `scripts/test-store.sh` verifies two source-built bundles against lock-only rebuilds after deleting the source tree, compares every bundle file and generated output, preserves a deliberately reformatted lock, and verifies shared-pattern deduplication (five blobs for two three-package songs). Missing stores, missing blobs, corrupted blobs, and changed sources during caching are rejected. Concurrent matching writers, preexisting corruption, symlinks, invalid digest paths, and oversized blobs are covered by the filesystem tests.

## Feedback-grade v2

The additive v2 acceptance driver (`scripts/test-chart-v2.mjs`) executes the real author and runtime components. It covers all six feedback domains, including:

- Two retained weighted variants, with actual holds, center/corner brackets, silence, repetitions, and whole-layout mirroring.
- A generated PCM WAV with a 100 ms offset and 120-to-150 BPM change; exact schedule checks at ticks 0, 16, and 32 give 100,000, 2,100,000, and 3,700,000 microseconds.
- Deterministic replay, exact original/retained/rejected probability accounting, recent-history exclusion, and explicit all-excluded fallback.
- Required accent damage, exclusive/shared credit, held negative space, mirrored motifs, impossible five-panel contact, and hold-release travel rejection.
- Difficulty rejection, fatal evaluator budgets, malformed tempo fractions, and rejection of codec limits too small to publish a readable bundle.
- Semantic certificate reproduction after a report is forged and its file digest updated, rather than trusting claimed witnesses.
- Ed25519 key generation, restricted private-key permissions, externally anchored verification, wrong-key/signature rejection, and signature-symlink refusal.

Independent review also added regressions for repeated same-pose contact clocks, overlapping accent allocation, iterative matching stack safety, indexed hold endpoints, encoder/decoder limit symmetry, and full native-reference comparison of guest selection/probability/history metadata. The old v1 zero-seed Plan and generated-trace digests remain fixed golden values and pass the complete suite.

Manual CLI QA created `bundle/feedback-v2`, generated held notes at ticks 0, 8, 16, and 24, checked the exact music schedule and intent scores, and verified a locally signed bundle with an explicitly supplied trusted key. Generated demo artifacts and keys are not source-controlled; signing keys were created outside the workspace. No production publisher trust is implied.

## Package feedback bridge

The package-feedback driver (`scripts/test-package-feedback.mjs`) builds three real WASM package
songs through both source and CAS paths, deletes the original source files, and requires every
resulting bundle file to match. A correlated-repeat song retains exactly two outcomes with masses
5/6 and 1/6; each generated second phrase equals its first after a five-tick shift. The driver also
checks duration mismatch rejection, source-free verification, forged conversion statistics after
rehashing, and signature rejection after removing the bridge extension. Existing signed standalone
v2 demo bundles remain readable and reproducible.

## SSC export

`scripts/test-chart-v2.mjs` exercises SSC export through the actual CLI, including bound audio
bytes, replay digests, explicit signature trust, deterministic selection, and no-clobber output.
`scripts/test-ssc-parser.sh` independently parses both history-conditioned chart variants with
`simfile==2.1.1`. It compares every tap, hold head, hold tail, lane, and beat against the generated
source chart, and checks the parser's timing engine against the exact source schedule across the
offset and BPM change. Escaped metadata and invalid-seed rejection are also checked.

The parser runs locally through uv with Python 3.12 and declares its pinned Python dependencies
in the script, separate from the product's Rust dependencies. The full test suite invokes it after
rebuilding the CLI. To run just this interoperability check after building:

```sh
sh scripts/test-ssc-parser.sh
```

This is independent parser and timing-engine evidence, not an actual StepMania or OutFox gameplay
test. Those applications were not launched. Their rendering, audio decoding, input handling, and
platform-specific numeric precision remain outside these checks.

## StepMania preparation

`node scripts/test-prepare-stepmania.mjs` exercises the real preparation CLI from outside the
repository directory. It checks both demo candidates, custom bundle/history fallback, spaced paths,
replay equivalence, audio/SSC hashes, help before building, and rejection of invalid seeds,
incomplete inputs, unknown options, existing destinations, and dangling output symlinks.
See [the StepMania setup guide](stepmania.md) for the unexecuted desktop checklist; preparation is
not evidence that the game was installed or played in this workspace.

## Platform and tooling limitations

The native default gate passed with a failing Docker sentinel first on PATH; no Docker call was
made. Command doubles exercise host-target publication, ordinary-versus-fixture component builds,
Windows `pump.exe` selection, quoted arguments, and missing-tool failures without Docker fallback.
Three resolver unit tests cover Windows/non-Windows names and explicit overrides. Manual native
QA created and verified a StepMania pack at a spaced absolute path outside the repository.
These are Linux execution and simulated Git Bash checks, not a physical Windows/MSVC run.

Windows keygen remains deliberately fail-closed because private-key ACL enforcement is not yet
implemented. Tests preserve sign/verify/tamper coverage using deterministic test-only keys after
checking rejection creates no files. Symlink-specific cases may report a Windows capability skip
when the OS denies symlink creation; Unix coverage and core filesystem defenses remain intact.

Rust, JavaScript, Python, and shell LSP servers were unavailable; compiler, Clippy, syntax checks,
and executable tests were used instead. No LSP-clean claim is made.
The Python parser driver passed Ruff and had zero BasedPyright errors; four warnings remain at
the third-party simfile API's incomplete type annotations. No type-check suppressions were added.

The upstream locked `wasm-tools` installation emits a warning about its yanked transitive `chacha20 0.10.0` dependency. Installation preserves that upstream lock instead of silently changing dependency resolution. It is a build-time tool, on the host by default or in the optional build image, not part of the deployed CLI runtime; dependency/security auditing remains required before production release.

These checks are development evidence, not a signed certification, a calibrated difficulty assessment, or a proof of human physical feasibility.
