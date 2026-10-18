set shell := ["sh", "-eu", "-c"]
set positional-arguments

default:
    @just --list

# Compile native release CLI, WASM components, and fixtures into dist.
build:
    sh scripts/build.sh

# Build the compact Linux runtime image and extract it into dist/docker.
build-docker:
    sh scripts/build-docker.sh

# Check Rust formatting, Clippy, and workspace tests with the host toolchain.
check:
    sh scripts/check.sh

# Check Rust formatting, Clippy, and workspace tests in Docker.
check-docker:
    sh scripts/check-docker.sh

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

# Pass arguments to the native CLI, preserving spaces and shell characters.
pump *args:
    sh scripts/run.sh pump "$@"

# Prepare StepMania songs; pass --out and optional seed/bundle/audio arguments.
stepmania *args:
    sh scripts/run.sh stepmania "$@"

# Run the development HTTP gateway using existing dist and bundle artifacts.
serve:
    sh scripts/run.sh serve

# Install the web editor and Part runtime with the pinned package manager.
studio-install:
    sh scripts/studio.sh install

# Build the web editor and its local server; does not build the Rust CLI.
studio-build:
    sh scripts/studio.sh build

# Type-check and lint the web application.
studio-check:
    sh scripts/studio.sh check

# Test the editor model, HTTP API, and real Part model/tool loop.
studio-test:
    sh scripts/studio.sh test

# Serve the built editor and agent runtime on localhost:4173.
studio:
    sh scripts/studio.sh start

# Run the Vite client; use studio-dev-server in another terminal.
studio-dev:
    sh scripts/studio.sh dev

# Run the watched studio API for Vite development.
studio-dev-server:
    sh scripts/studio.sh dev-server
