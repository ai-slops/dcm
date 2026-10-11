#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. scripts/docker.sh

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

windows=false
if docker_host_is_windows; then windows=true; fi
container=false
if [ "$windows" = true ] || [ "${PUMP_RUN_CONTAINER:-0}" = 1 ]; then container=true; fi

if [ "$mode" = test-e2e ]; then
  if [ "$container" = true ]; then
    PUMP_BINARY= sh scripts/test-ssc-parser.sh
  else
    sh scripts/test-ssc-parser.sh
    exec sh scripts/test-e2e-internal.sh
  fi
fi

if [ "$container" = false ]; then
  case "$mode" in
    pump) exec "${PUMP_BINARY:-./dist/pump}" "$@" ;;
    stepmania) exec node scripts/prepare-stepmania.mjs "$@" ;;
    serve) exec node app/server.mjs ;;
  esac
fi

if [ "$mode" = serve ] && [ -n "${PUMP_BUNDLE:-}" ]; then
  case "$PUMP_BUNDLE" in
    /workspace|/workspace/*) ;;
    /*|?:/*|?:\\*)
      printf '%s\n' 'PUMP_BUNDLE must be repository-relative or under /workspace in container mode' >&2
      exit 2
      ;;
  esac
fi

runner="pump-runner:0.1.0"
root_host="$(docker_host_path "$(pwd -P)")"
mount="$root_host:/workspace"

docker_run() {
  if [ "$windows" = true ]; then
    docker_cmd run --rm "$@"
  else
    docker_cmd run --rm --user "$(id -u):$(id -g)" "$@"
  fi
}

if docker_run --volume "$mount" --workdir /workspace "$runner" \
  test -r /workspace/scripts/test-e2e-internal.sh; then
  :
else
  status=$?
  printf 'Docker cannot read the PUMP workspace at %s as /workspace; share that host path with the Docker daemon and ensure scripts/test-e2e-internal.sh is readable.\n' "$root_host" >&2
  exit "$status"
fi

case "$mode" in
  pump)
    docker_run --volume "$mount" --workdir /workspace "$runner" /opt/pump/pump "$@"
    ;;
  stepmania)
    docker_run --volume "$mount" --workdir /workspace "$runner" \
      node scripts/prepare-stepmania.mjs "$@"
    ;;
  serve)
    port="${PUMP_PORT:-3000}"
    case "$port" in
      ''|*[!0-9]*) printf '%s\n' 'PUMP_PORT must be a numeric host port' >&2; exit 2 ;;
    esac
    if [ -n "${PUMP_BUNDLE:-}" ]; then
      docker_run --init --publish "127.0.0.1:$port:3000" --volume "$mount" \
        --workdir /workspace --env "PUMP_BUNDLE=$PUMP_BUNDLE" "$runner" node app/server.mjs
    else
      docker_run --init --publish "127.0.0.1:$port:3000" --volume "$mount" \
        --workdir /workspace "$runner" node app/server.mjs
    fi
    ;;
  test-e2e)
    docker_run --volume "$mount" --workdir /workspace "$runner" sh scripts/test-e2e-internal.sh
    ;;
esac
