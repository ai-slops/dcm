#!/bin/sh
set -eu
umask 077

NODE_VERSION=24.22.0
COREPACK_VERSION=0.36.0
PNPM_VERSION=10.17.1
RUST_VERSION=1.94.0
RUSTUP_VERSION=1.28.2
WASM_TOOLS_VERSION=1.254.0

ROOT=${STUDIO_PREVIEW_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
STATE=${STUDIO_PREVIEW_STATE_DIR:-$ROOT/.studio-dev}
TOOLS=$STATE/tools

fail() { printf 'studio-prerequisites: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required to bootstrap Studio"; }
version_at_least() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||a===24&&b>=22?0:1)' >/dev/null 2>&1
}

platform() {
  case "$(uname -m)" in x86_64) ARCH=x64; RUST_ARCH=x86_64 ;; aarch64|arm64) ARCH=arm64; RUST_ARCH=aarch64 ;; *) fail "unsupported architecture: $(uname -m)" ;; esac
  if ldd --version 2>&1 | grep -qi musl; then LIBC=musl; else LIBC=gnu; fi
}

download() {
  url=$1 output=$2
  need curl
  curl --fail --location --silent --show-error "$url" --output "$output"
}

ensure_node() {
  mkdir -p "$TOOLS"
  if [ -n "${STUDIO_PREVIEW_NODE:-}" ] && version_at_least "$STUDIO_PREVIEW_NODE"; then NODE=$STUDIO_PREVIEW_NODE
  elif command -v node >/dev/null 2>&1 && version_at_least "$(command -v node)"; then NODE=$(command -v node)
  else
    platform
    NODE_HOME=$TOOLS/node-v$NODE_VERSION-$LIBC-$ARCH
    NODE=$NODE_HOME/bin/node
    if ! [ -x "$NODE" ]; then
      need tar; need sha256sum
      if [ "$LIBC" = musl ]; then
        base=https://unofficial-builds.nodejs.org/download/release/v$NODE_VERSION
        archive=node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz
      else
        base=https://nodejs.org/dist/v$NODE_VERSION
        archive=node-v$NODE_VERSION-linux-$ARCH.tar.xz
      fi
      temporary=$TOOLS/node-download.$$
      trap 'rm -rf "$temporary"' EXIT HUP INT TERM
      mkdir -m 700 "$temporary"
      download "$base/SHASUMS256.txt" "$temporary/SHASUMS256.txt"
      download "$base/$archive" "$temporary/$archive"
      grep "  $archive\$" "$temporary/SHASUMS256.txt" >"$temporary/checksums" || fail "Node checksum is absent from manifest"
      (cd "$temporary" && sha256sum -c checksums) >&2
      mkdir -p "$NODE_HOME"
      tar -xJf "$temporary/$archive" --strip-components=1 -C "$NODE_HOME"
      rm -rf "$temporary"
      trap - EXIT HUP INT TERM
    fi
  fi
  printf '%s\n' "$NODE"
}

ensure_corepack() {
  PATH="$(dirname -- "$NODE"):$PATH"
  export PATH
  COREPACK_JS=$TOOLS/corepack/node_modules/corepack/dist/corepack.js
  if ! [ -f "$COREPACK_JS" ] || ! "$NODE" "$COREPACK_JS" --version 2>/dev/null | grep -qx "$COREPACK_VERSION"; then
    npm_cli=$(dirname -- "$NODE")/../lib/node_modules/npm/bin/npm-cli.js
    if [ -f "$npm_cli" ]; then
      "$NODE" "$npm_cli" install --no-audit --no-fund --prefix "$TOOLS/corepack" "corepack@$COREPACK_VERSION"
    else
      npm=$(command -v npm || true)
      [ -n "$npm" ] || fail "npm is required to install Corepack"
      "$npm" install --no-audit --no-fund --prefix "$TOOLS/corepack" "corepack@$COREPACK_VERSION"
    fi
  fi
  mkdir -p "$TOOLS/bin"
  ln -sf "$COREPACK_JS" "$TOOLS/bin/corepack"
  PATH="$TOOLS/bin:$PATH"
  export PATH
}

ensure_rust() {
  platform
  need sha256sum
  export CARGO_HOME=$TOOLS/cargo RUSTUP_HOME=$TOOLS/rustup
  rust_host=$RUST_ARCH-unknown-linux-$LIBC
  toolchain=$RUST_VERSION-$rust_host
  rustup=$CARGO_HOME/bin/rustup
  if ! [ -x "$rustup" ]; then
    temporary=$TOOLS/rustup-init.$$
    checksum=$temporary.sha256
    rustup_base=https://static.rust-lang.org/rustup/archive/$RUSTUP_VERSION/$rust_host
    download "$rustup_base/rustup-init" "$temporary"
    download "$rustup_base/rustup-init.sha256" "$checksum"
    expected=$(cut -d' ' -f1 <"$checksum")
    actual=$(sha256sum "$temporary" | cut -d' ' -f1)
    [ "$actual" = "$expected" ] || fail "rustup-init checksum mismatch"
    chmod 700 "$temporary"
    "$temporary" -y --no-modify-path --profile minimal --default-toolchain none
    rm -f "$temporary" "$checksum"
  fi
  "$rustup" toolchain install "$toolchain" --profile minimal --no-self-update
  "$rustup" target add --toolchain "$toolchain" wasm32-unknown-unknown
  CARGO=$CARGO_HOME/bin/cargo
  if ! [ -x "$TOOLS/wasm-tools/bin/wasm-tools" ] || ! "$TOOLS/wasm-tools/bin/wasm-tools" --version | grep -q "wasm-tools $WASM_TOOLS_VERSION"; then
    "$CARGO" "+$toolchain" install --locked --root "$TOOLS/wasm-tools" --version "$WASM_TOOLS_VERSION" wasm-tools
  fi
}

build_studio() {
  cd "$ROOT"
  need cc
  ensure_node >/dev/null
  ensure_corepack
  ensure_rust
  target=$($CARGO "+$toolchain" metadata --locked --no-deps --format-version 1 | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).target_directory))')
  host=$($CARGO "+$toolchain" -vV 2>/dev/null || "$CARGO_HOME/bin/rustc" "+$toolchain" -vV)
  host=$(printf '%s\n' "$host" | grep '^host: ' | cut -d' ' -f2)
  "$CARGO" "+$toolchain" build --locked --release --target "$host" -p pump
  "$CARGO" "+$toolchain" build --locked --release --target wasm32-unknown-unknown -p pump-chart-author-component -p pump-chart-runtime-component
  mkdir -p "$ROOT/dist"
  cp "$target/$host/release/pump" "$ROOT/dist/pump"
  chmod 755 "$ROOT/dist/pump"
  "$TOOLS/wasm-tools/bin/wasm-tools" component new "$target/wasm32-unknown-unknown/release/pump_chart_author_component.wasm" -o "$ROOT/dist/chart-author.component.wasm"
  "$TOOLS/wasm-tools/bin/wasm-tools" component new "$target/wasm32-unknown-unknown/release/pump_chart_runtime_component.wasm" -o "$ROOT/dist/chart-runtime.component.wasm"
  (cd "$ROOT/web" && "$NODE" "$COREPACK_JS" pnpm@$PNPM_VERSION install --frozen-lockfile && "$NODE" "$COREPACK_JS" pnpm@$PNPM_VERSION run build)
}

case "${1:-build}" in
  node) ensure_node ;;
  build) build_studio ;;
  --help|-h) printf '%s\n' 'usage: studio-prerequisites.sh {node|build}' ;;
  *) fail "unknown command: $1" ;;
esac
