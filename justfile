set shell := ["sh", "-eu", "-c"]
set positional-arguments

default:
    @just --list

# Compile release CLI, WASM components, and fixtures into dist; no quality checks.
build:
    sh scripts/build.sh

# Check Rust formatting, Clippy, and workspace tests in the pinned Docker toolchain.
check:
    sh scripts/check.sh

# Check formatting without changing source files.
fmt-check:
    sh scripts/check.sh fmt

# Run Clippy with warnings treated as errors.
lint:
    sh scripts/check.sh lint

# Run Rust workspace tests without release compilation or E2E tests.
test-unit:
    sh scripts/check.sh unit

# Verify Windows-style Git checkout preserves LF text and binary bytes.
check-eol:
    node scripts/test-line-endings.mjs

# Full verification: checkout regression, Rust checks, build, and all E2E tests.
test:
    sh scripts/test.sh

# Run E2E tests against existing dist artifacts; does not rebuild or lint.
test-e2e:
    sh scripts/test-e2e.sh

# Pass arguments to the built Linux CLI, preserving spaces and shell characters.
pump *args:
    sh scripts/run.sh pump "$@"

# Prepare StepMania songs; pass --out and optional seed/bundle/audio arguments.
stepmania *args:
    sh scripts/run.sh stepmania "$@"

# Run the development HTTP gateway using existing dist and bundle artifacts.
serve:
    sh scripts/run.sh serve
