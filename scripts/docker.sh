#!/bin/sh

docker_cmd() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker "$@"
}

docker_host_is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

docker_host_path() {
  if [ "$#" -ne 1 ] || [ ! -e "$1" ]; then
    printf '%s\n' 'docker_host_path requires one existing local path' >&2
    return 2
  fi
  case "$1" in
    /*) ;;
    *)
      printf '%s\n' 'docker_host_path requires an absolute local path' >&2
      return 2
      ;;
  esac
  if docker_host_is_windows; then
    cygpath -m -- "$1"
  else
    printf '%s\n' "$1"
  fi
}
