#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. scripts/docker.sh
work="$(mktemp -d)"
container="pump-ssc-parser-$$"
trap 'docker_cmd rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
node scripts/make-feedback-audio.mjs "$work/music.wav"
scripts_host="$(docker_host_path "$(pwd -P)/scripts")"
dist_host="$(docker_host_path "$(pwd -P)/dist")"
audio_host="$(docker_host_path "$work/music.wav")"
docker_cmd create --name "$container" --workdir /work \
  ghcr.io/astral-sh/uv:0.6.17-python3.12-bookworm-slim@sha256:dd4604bc0a1a75de967a4fc632e4d4012e5924f55711f9c01f4c8f4c1801ca43 \
  sh -eu -c 'chmod +x /work/dist/pump; exec uv run scripts/test-ssc-parser.py /work/music.wav' >/dev/null
docker_cmd cp "$scripts_host" "$container:/work/scripts"
docker_cmd cp "$dist_host" "$container:/work/dist"
if [ -n "${PUMP_BINARY:-}" ]; then
  binary_directory="$(dirname "$PUMP_BINARY")"
  binary_name="$(basename "$PUMP_BINARY")"
  binary_path="$(cd "$binary_directory" && pwd -P)/$binary_name"
  binary_host="$(docker_host_path "$binary_path")"
  docker_cmd cp "$binary_host" "$container:/work/dist/pump"
fi
docker_cmd cp "$audio_host" "$container:/work/music.wav"
docker_cmd start --attach "$container"
test "$(docker_cmd inspect --format '{{.State.ExitCode}}' "$container")" -eq 0
