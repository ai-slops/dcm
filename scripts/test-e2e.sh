#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

sh scripts/run.sh test-e2e
