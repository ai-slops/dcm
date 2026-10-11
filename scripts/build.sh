#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
runtime_image="pump-toolchain:0.1.0"
runner_image="pump-runner:0.1.0"
container="pump-artifacts-$$"
. scripts/docker.sh
trap 'docker_cmd rm -f "$container" >/dev/null 2>&1 || true' EXIT

mkdir -p dist
root_host="$(docker_host_path "$(pwd -P)")"
dist_host="$(docker_host_path "$(pwd -P)/dist")"
docker_cmd build --target runtime --tag "$runtime_image" "$root_host"
docker_cmd build --target runner --tag "$runner_image" "$root_host"
docker_cmd create --name "$container" --entrypoint /bin/true "$runtime_image" >/dev/null
docker_cmd cp "$container:/opt/pump/." "$dist_host"
chmod +x dist/pump
