#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
container="pump-ssc-parser-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
node scripts/make-feedback-audio.mjs "$work/music.wav"
docker create --name "$container" --workdir /work \
  ghcr.io/astral-sh/uv:0.6.17-python3.12-bookworm-slim@sha256:dd4604bc0a1a75de967a4fc632e4d4012e5924f55711f9c01f4c8f4c1801ca43 \
  uv run scripts/test-ssc-parser.py /work/music.wav >/dev/null
docker cp scripts "$container:/work/scripts"
docker cp dist "$container:/work/dist"
if [ -n "${PUMP_BINARY:-}" ]; then
  docker cp "$PUMP_BINARY" "$container:/work/dist/pump"
fi
docker cp "$work/music.wav" "$container:/work/music.wav"
docker start --attach "$container"
test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" -eq 0
