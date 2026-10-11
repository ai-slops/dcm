#!/bin/sh

native_is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

native_path_for_node() {
  if native_is_windows; then
    case "$1" in
      /*) cygpath -m -- "$1"; return ;;
    esac
  fi
  printf '%s\n' "$1"
}

native_path_for_shell() {
  if native_is_windows; then
    cygpath -u -- "$1"
  else
    printf '%s\n' "$1"
  fi
}

if native_is_windows; then
  PUMP_BINARY="${PUMP_BINARY:-dist/pump.exe}"
else
  PUMP_BINARY="${PUMP_BINARY:-dist/pump}"
fi
PUMP_BINARY="$(native_path_for_node "$PUMP_BINARY")"
export PUMP_BINARY
