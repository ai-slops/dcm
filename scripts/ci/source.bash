#!/usr/bin/env bash
set -euo pipefail
# The compiler starts in /workspace/main but mounts this script at /run/dim/job/script.
# Keep that reviewed repository working directory; $0 is not its source path.
if [ ! -f Cargo.toml ] || [ ! -f scripts/studio-prerequisites.sh ]; then
  printf '%s\n' 'Run source CI from the candidate repository root.' >&2
  exit 1
fi

stage=prerequisites
trap 'printf "DCM source CI failed during %s (line %s)\n" "$stage" "$LINENO" >&2' ERR
step() { stage=$1; printf '\nDCM source CI: %s\n' "$stage"; }

# DIM materializes a fresh checkout without .git. Keep tool state separate from
# the Studio preview; no password, saved chart/audio or running server is used.
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export STUDIO_PREVIEW_STATE_DIR="$work/bootstrap"
export CARGO_HOME="$STUDIO_PREVIEW_STATE_DIR/tools/cargo"
export RUSTUP_HOME="$STUDIO_PREVIEW_STATE_DIR/tools/rustup"
export CARGO_TARGET_DIR="$work/target"
export CARGO_BUILD_JOBS=2

step 'system prerequisites'
if ! command -v cc >/dev/null || ! command -v curl >/dev/null || ! command -v xz >/dev/null; then
  if [ "$(id -u)" != 0 ] || ! command -v apt-get >/dev/null; then
    printf '%s\n' 'Install a C compiler, curl, CA certificates and xz before running source CI.' >&2
    exit 1
  fi
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends build-essential curl ca-certificates xz-utils pkg-config
fi

# Reuse the project-owned pinned Rust/Node/Corepack/WASM bootstrap and native
# Studio artifacts required by the real native API tests, rather than mock them.
step 'pinned tools and native Studio build'
sh scripts/studio-prerequisites.sh build
node=$(sh scripts/studio-prerequisites.sh node)
export PATH="$(dirname "$node"):$STUDIO_PREVIEW_STATE_DIR/tools/bin:$CARGO_HOME/bin:$STUDIO_PREVIEW_STATE_DIR/tools/wasm-tools/bin:$PATH"
rustup component add rustfmt clippy

step 'Rust formatting, Clippy and workspace tests'
sh scripts/check.sh
step 'web strict types and lint'
sh scripts/studio.sh check
step 'web tests with real native runtime'
sh scripts/studio.sh test
step 'web production build'
sh scripts/studio.sh build
printf '\n%s\n' 'DCM source CI passed.'
