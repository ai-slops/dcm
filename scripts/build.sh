#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
. scripts/native.sh

required_wasm_tools='1.254.0'
if ! command -v wasm-tools >/dev/null 2>&1; then
  printf 'wasm-tools %s is required; install that exact version and place it on PATH.\n' "$required_wasm_tools" >&2
  exit 1
fi
actual_wasm_tools="$(wasm-tools --version 2>/dev/null || true)"
if [ "$actual_wasm_tools" != "wasm-tools $required_wasm_tools" ]; then
  printf 'wasm-tools %s is required, but found: %s\n' "$required_wasm_tools" "${actual_wasm_tools:-unknown version}" >&2
  exit 1
fi

host_target="$(rustc -vV | while IFS= read -r line; do case "$line" in 'host: '*) printf '%s\n' "${line#host: }"; break ;; esac; done)"
if [ -z "$host_target" ]; then
  printf '%s\n' 'Unable to determine the native Rust host target from rustc -vV.' >&2
  exit 1
fi
metadata="$(cargo metadata --locked --no-deps --format-version 1)"
target_directory="$(printf '%s' "$metadata" | node -e 'let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).target_directory));')"
target_directory="$(native_path_for_shell "$target_directory")"
wasm_release="$target_directory/wasm32-unknown-unknown/release"

# An explicit host target keeps CLI publication independent of Cargo's default-target configuration.
cargo build --locked --release --target "$host_target" -p pump
cargo build --locked --release --target wasm32-unknown-unknown \
  -p pump-author-component -p pump-runtime-component -p pump-pattern-component \
  -p pump-style-calm-component -p pump-style-bold-component \
  -p pump-song-a-component -p pump-song-b-component \
  -p pump-chart-author-component -p pump-chart-runtime-component \
  -p pump-song-correlated-component

mkdir -p dist
if native_is_windows; then
  rm -f dist/pump
  cp "$target_directory/$host_target/release/pump.exe" dist/pump.exe
  chmod +x dist/pump.exe
else
  rm -f dist/pump.exe
  cp "$target_directory/$host_target/release/pump" dist/pump
  chmod +x dist/pump
fi

componentize() {
  wasm_tools_input="$1"
  wasm_tools_output="$2"
  wasm-tools component new "$wasm_release/$wasm_tools_input" -o "dist/$wasm_tools_output"
}

componentize pump_author_component.wasm author.component.wasm
componentize pump_runtime_component.wasm runtime.component.wasm
componentize pump_pattern_component.wasm pattern.component.wasm
componentize pump_style_calm_component.wasm style-calm.component.wasm
componentize pump_style_bold_component.wasm style-bold.component.wasm
componentize pump_song_a_component.wasm song-a.component.wasm
componentize pump_song_b_component.wasm song-b.component.wasm
componentize pump_chart_author_component.wasm chart-author.component.wasm
componentize pump_chart_runtime_component.wasm chart-runtime.component.wasm
componentize pump_song_correlated_component.wasm song-correlated.component.wasm

cargo build --locked --release --target wasm32-unknown-unknown \
  -p pump-pattern-component -p pump-song-a-component \
  --features pump-pattern-component/test-failure,pump-song-a-component/test-recovery
componentize pump_pattern_component.wasm fixture-pattern-failure.component.wasm
componentize pump_song_a_component.wasm fixture-song-recovery.component.wasm

cp examples/packages/*.json dist/
rm -rf dist/feedback dist/package-feedback
cp -R examples/feedback dist/feedback
cp -R examples/package-feedback dist/package-feedback
