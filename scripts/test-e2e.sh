#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. scripts/native.sh

sh scripts/test-ssc-parser.sh
exec sh scripts/test-e2e-internal.sh
