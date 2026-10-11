#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

node scripts/test-line-endings.mjs
node --test scripts/test-native-binary.mjs
node scripts/test-native-workflow.mjs
sh scripts/check.sh
sh scripts/build.sh
sh scripts/test-e2e.sh
