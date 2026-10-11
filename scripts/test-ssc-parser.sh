#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. scripts/native.sh
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
node scripts/make-feedback-audio.mjs "$work/music.wav"
uv run --python 3.12 scripts/test-ssc-parser.py "$work/music.wav"
