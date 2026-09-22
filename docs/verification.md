# Verification record

Verified in this workspace on x86-64 Linux using the pinned Docker build. ARM64, macOS, console hosts, and production game engines were not tested.

## Automated checks

`./scripts/test.sh` builds current sources rather than reusing stale `dist` files. The Docker build runs:

- `cargo fmt --all -- --check`
- `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`
- `cargo test --locked --workspace`: 52 tests passed (22 host/package tests and 30 core tests).
- Release builds of the CLI and both WASM guests, followed by componentization.

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

## Limitations

Rust and JavaScript LSP servers were unavailable; compiler, Clippy, syntax checks, and executable tests were used instead. No LSP-clean claim is made.

The upstream locked `wasm-tools` installation emits a warning about its yanked transitive `chacha20 0.10.0` dependency. The build preserves that upstream lock instead of silently changing dependency resolution. That tool is used only in the build image, not in the deployed runtime image; dependency/security auditing remains required before production release.

These checks are development evidence, not a signed certification, a calibrated difficulty assessment, or a proof of human physical feasibility.
