#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fake="$work/bin"
log="$work/docker-log"
real_node="$(command -v node)"
mkdir "$fake" "$log"
mkdir -p "$work/project/scripts" "$work/project/dist"
cp scripts/docker.sh scripts/run.sh scripts/test-ssc-parser.sh scripts/prepare-stepmania.mjs "$work/project/scripts/"
cd "$work/project"

cat >"$fake/uname" <<'SH'
#!/bin/sh
printf '%s\n' "${FAKE_UNAME:-MINGW64_NT-10.0}"
SH
cat >"$fake/cygpath" <<'SH'
#!/bin/sh
test "$1" = -m
shift
test "$1" = --
shift
path="$1"
if [ -n "${CYGPATH_LOG:-}" ]; then printf '%s' "$path" >"$CYGPATH_LOG"; fi
if [ "$path" = "$TEST_ROOT" ]; then
  printf 'C:/git/pump'
else
  printf 'C:/converted/%s' "$(basename "$path")"
fi
SH
cat >"$fake/docker" <<'SH'
#!/bin/sh
set -eu
count_file="$DOCKER_LOG/count"
count=0
if [ -f "$count_file" ]; then count="$(cat "$count_file")"; fi
count=$((count + 1))
printf '%s\n' "$count" >"$count_file"
call="$DOCKER_LOG/call-$count"
mkdir "$call"
printf '%s' "${MSYS_NO_PATHCONV:-}" >"$call/msys-no-pathconv"
printf '%s' "${MSYS2_ARG_CONV_EXCL:-}" >"$call/msys2-arg-conv-excl"
index=0
for argument do
  index=$((index + 1))
  printf '%s' "$argument" >"$call/arg-$index"
done
printf '%s\n' "$index" >"$call/argc"
if [ "${DOCKER_FAIL_ON_CALL:-}" = "$count" ]; then exit "${DOCKER_FAIL_STATUS:-1}"; fi
if [ "$1" = inspect ]; then printf '%s\n' 0; fi
SH
cat >"$fake/id" <<'SH'
#!/bin/sh
case "$1" in
  -u) printf '%s\n' 1234 ;;
  -g) printf '%s\n' 5678 ;;
  *) exit 2 ;;
esac
SH
cat >"$fake/node" <<'SH'
#!/bin/sh
if [ "${1:-}" = scripts/make-feedback-audio.mjs ]; then
  : >"$2"
  exit 0
fi
exec "$REAL_NODE" "$@"
SH
chmod +x "$fake/uname" "$fake/cygpath" "$fake/docker" "$fake/id" "$fake/node"

assert_file() {
  expected="$1"
  path="$2"
  actual="$(cat "$path")"
  test "$actual" = "$expected" || {
    printf 'expected %s in %s, got %s\n' "$expected" "$path" "$actual" >&2
    exit 1
  }
}

reset_log() {
  rm -rf "$log"
  mkdir "$log"
}

run_windows() {
  PATH="$fake:$PATH" DOCKER_LOG="$log" REAL_NODE="$real_node" TEST_ROOT="$(pwd -P)" "$@"
}

normalized="$(PATH="$fake:$PATH" TEST_ROOT="$(pwd -P)" sh -c '. scripts/docker.sh; docker_host_path "$PWD"')"
test "$normalized" = 'C:/git/pump'

run_windows sh scripts/run.sh pump 'argument with spaces' 'literal;$HOME*'
assert_file 2 "$log/count"
assert_file 1 "$log/call-1/msys-no-pathconv"
assert_file '*' "$log/call-1/msys2-arg-conv-excl"
assert_file 'C:/git/pump:/workspace' "$log/call-1/arg-4"
assert_file '/workspace' "$log/call-1/arg-6"
assert_file '/opt/pump/pump' "$log/call-2/arg-8"
assert_file 'argument with spaces' "$log/call-2/arg-9"
assert_file 'literal;$HOME*' "$log/call-2/arg-10"

reset_log
run_windows sh scripts/run.sh stepmania --out 'bundle/output with spaces'
assert_file node "$log/call-2/arg-8"
assert_file scripts/prepare-stepmania.mjs "$log/call-2/arg-9"
assert_file 'bundle/output with spaces' "$log/call-2/arg-11"

reset_log
PUMP_PORT=4312 PUMP_BUNDLE=/workspace/bundle run_windows sh scripts/run.sh serve
assert_file --init "$log/call-2/arg-3"
assert_file '127.0.0.1:4312:3000' "$log/call-2/arg-5"
assert_file PUMP_BUNDLE=/workspace/bundle "$log/call-2/arg-11"
assert_file node "$log/call-2/arg-13"
assert_file app/server.mjs "$log/call-2/arg-14"

reset_log
PUMP_BINARY="$work/missing-host-override" run_windows sh scripts/run.sh test-e2e
assert_file sh "$log/call-1/arg-7"
assert_file 'chmod +x /work/dist/pump; exec uv run scripts/test-ssc-parser.py /work/music.wav' "$log/call-1/arg-10"
assert_file sh "$log/call-9/arg-8"
assert_file scripts/test-e2e-internal.sh "$log/call-9/arg-9"

reset_log
mkdir "$work/non-executable"
printf '%s\n' fixture >"$work/non-executable/pump fixture"
chmod -x "$work/non-executable/pump fixture"
relative_binary="../non-executable/pump fixture"
absolute_binary="$(cd "$(dirname "$relative_binary")" && pwd -P)/$(basename "$relative_binary")"
CYGPATH_LOG="$work/cygpath-input" PUMP_BINARY="$relative_binary" run_windows sh scripts/test-ssc-parser.sh
assert_file "$absolute_binary" "$work/cygpath-input"
assert_file 'C:/converted/pump fixture' "$log/call-4/arg-2"
assert_file 'chmod +x /work/dist/pump; exec uv run scripts/test-ssc-parser.py /work/music.wav' "$log/call-1/arg-10"

reset_log
set +e
PATH="$fake:$PATH" DOCKER_LOG="$log" DOCKER_FAIL_ON_CALL=2 DOCKER_FAIL_STATUS=37 sh scripts/run.sh pump --help
status=$?
set -e
test "$status" -eq 37

reset_log
set +e
PATH="$fake:$PATH" DOCKER_LOG="$log" TEST_ROOT="$(pwd -P)" DOCKER_FAIL_ON_CALL=1 DOCKER_FAIL_STATUS=29 sh scripts/run.sh pump --help 2>"$work/preflight-error"
status=$?
set -e
test "$status" -eq 29
assert_file 1 "$log/count"
test "$(cat "$work/preflight-error")" = "Docker cannot read the PUMP workspace at C:/git/pump as /workspace; share that host path with the Docker daemon and ensure scripts/test-e2e-internal.sh is readable."

reset_log
set +e
PUMP_BUNDLE='C:/host/bundle' run_windows sh scripts/run.sh serve 2>"$work/error"
status=$?
set -e
test "$status" -eq 2
test ! -f "$log/count"
test "$(cat "$work/error")" = 'PUMP_BUNDLE must be repository-relative or under /workspace in container mode'

reset_log
FAKE_UNAME=Linux PUMP_RUN_CONTAINER=1 run_windows sh scripts/run.sh pump --help
assert_file --user "$log/call-1/arg-3"
assert_file 1234:5678 "$log/call-1/arg-4"
assert_file "$(pwd -P):/workspace" "$log/call-1/arg-6"

reset_log
FAKE_UNAME=Linux run_windows sh scripts/run.sh stepmania --help >"$work/help"
test ! -f "$log/count"
test -s "$work/help"

printf '%s\n' 'Docker runtime dispatch regression passed.'
