#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ "$#" -gt 1 ]; then
  printf '%s\n' 'Usage: sh scripts/check.sh [all|fmt|lint|unit]' >&2
  exit 2
fi
case "${1:-all}" in
  all) command='cargo fmt --all -- --check && cargo clippy --locked --workspace --all-targets --all-features -- -D warnings && cargo test --locked --workspace' ;;
  fmt) command='cargo fmt --all -- --check' ;;
  lint) command='cargo clippy --locked --workspace --all-targets --all-features -- -D warnings' ;;
  unit) command='cargo test --locked --workspace' ;;
  *) printf '%s\n' 'Usage: sh scripts/check.sh [all|fmt|lint|unit]' >&2; exit 2 ;;
esac
sh -eu -c "$command"
