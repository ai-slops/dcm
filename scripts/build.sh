#!/bin/sh
set -eu

image="pump-toolchain:0.1.0"
cd "$(dirname "$0")/.."
container="pump-artifacts-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker build --tag "$image" .
mkdir -p dist
docker create --name "$container" --entrypoint /bin/true "$image" >/dev/null
docker cp "$container:/opt/pump/." dist
chmod +x dist/pump
