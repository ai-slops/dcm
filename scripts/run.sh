#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. scripts/native.sh

usage() {
  printf '%s\n' 'Usage: sh scripts/run.sh pump|stepmania|serve|test-e2e [arguments...]' >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
mode="$1"
shift
case "$mode" in
  pump|stepmania) ;;
  serve|test-e2e) [ "$#" -eq 0 ] || usage ;;
  *) usage ;;
esac

case "$mode" in
  pump) exec "$PUMP_BINARY" "$@" ;;
  stepmania) exec node scripts/prepare-stepmania.mjs "$@" ;;
  serve)
    if [ -n "${PUMP_BUNDLE:-}" ]; then
      PUMP_BUNDLE="$(native_path_for_node "$PUMP_BUNDLE")"
      export PUMP_BUNDLE
    fi
    exec node app/server.mjs
    ;;
  test-e2e) exec sh scripts/test-e2e.sh ;;
esac
