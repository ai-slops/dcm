#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
. scripts/docker.sh

image="pump-runtime:0.1.0"
container="pump-docker-artifacts-$$"
trap 'docker_cmd rm -f "$container" >/dev/null 2>&1 || true' EXIT

mkdir -p dist
rm -rf dist/docker
mkdir dist/docker
root_host="$(docker_host_path "$(pwd -P)")"
dist_host="$(docker_host_path "$(pwd -P)/dist/docker")"
docker_cmd build --target runtime --tag "$image" "$root_host"
docker_cmd create --name "$container" --entrypoint /bin/true "$image" >/dev/null
docker_cmd cp "$container:/opt/pump/." "$dist_host"
chmod +x dist/docker/pump
