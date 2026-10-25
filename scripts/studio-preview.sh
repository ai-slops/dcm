#!/bin/sh
set -eu

ROOT=${STUDIO_PREVIEW_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
NODE=$(sh "$ROOT/scripts/studio-prerequisites.sh" node)
exec "$NODE" "$ROOT/scripts/studio-preview.mjs" "$@"
