#!/bin/sh
set -eu
cd "$(dirname "$0")/../web"

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 22)) { process.stderr.write("PUMP Studio requires Node.js 24.22.0 or newer for @slop-lab/part.\n"); process.exit(1); }'
if ! command -v corepack >/dev/null 2>&1; then
  printf '%s\n' 'Corepack is required for the pinned web package manager; see docs/studio.md.' >&2
  exit 1
fi
if [ "$#" -gt 1 ]; then
  printf '%s\n' 'Usage: sh scripts/studio.sh [install|build|check|test|browser-ucs|start|dev|dev-server]' >&2
  exit 2
fi

case "${1:-start}" in
  install) exec corepack pnpm install --frozen-lockfile ;;
  build) exec corepack pnpm run build ;;
  check) corepack pnpm run typecheck; exec corepack pnpm run lint ;;
  test) exec corepack pnpm run test ;;
  browser-ucs) exec corepack pnpm run test:browser:ucs ;;
  start) exec corepack pnpm run start ;;
  dev) exec corepack pnpm run dev ;;
  dev-server) exec corepack pnpm run dev:server ;;
  *) printf '%s\n' 'Usage: sh scripts/studio.sh [install|build|check|test|browser-ucs|start|dev|dev-server]' >&2; exit 2 ;;
esac
