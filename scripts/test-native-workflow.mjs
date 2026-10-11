import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'pump native workflow-'));
const project = join(work, 'project');
const fakeBin = join(work, 'bin');
const toolLog = join(work, 'tools.log');
const runLog = join(work, 'run.log');
const dockerLog = join(work, 'docker-called');

function shellPath(path) {
  const result = spawnSync('sh', [
    '-c',
    'case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exec cygpath -u -- "$1" ;; *) printf "%s\\n" "$1" ;; esac',
    'pump-native-workflow-path',
    path,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `cannot normalize shell path ${path}\n${result.stderr}`);
  return result.stdout.replace(/\r?\n$/, '');
}

const shellFakeBin = shellPath(fakeBin);
const shellProject = shellPath(project);
const shellToolLog = shellPath(toolLog);
const shellRunLog = shellPath(runLog);
const shellDockerLog = shellPath(dockerLog);
const shellNode = shellPath(process.execPath);

function executable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function invoke(script, args = [], extraEnv = {}, expectedStatus = 0) {
  const result = spawnSync('sh', [
    '-c',
    'PATH="$1:$PATH"; export PATH; shift; exec "$@"',
    'pump-native-workflow-invoke',
    shellFakeBin,
    'sh',
    script,
    ...args,
  ], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      REAL_NODE: shellNode,
      TEST_ROOT: shellProject,
      TOOL_LOG: shellToolLog,
      RUN_LOG: shellRunLog,
      DOCKER_LOG: shellDockerLog,
      FAKE_UNAME: 'MINGW64_NT-10.0',
      ...extraEnv,
    },
  });
  assert.equal(result.status, expectedStatus, `${script} ${args.join(' ')}\n${result.stderr}`);
  return result;
}

try {
  mkdirSync(join(project, 'scripts'), { recursive: true });
  mkdirSync(fakeBin);
  for (const name of ['build.sh', 'check.sh', 'native.sh', 'run.sh', 'test-e2e.sh']) {
    copyFileSync(join(root, 'scripts', name), join(project, 'scripts', name));
  }
  for (const name of ['packages', 'feedback', 'package-feedback']) {
    mkdirSync(join(project, 'examples', name), { recursive: true });
    writeFileSync(join(project, 'examples', name, name === 'packages' ? 'song-a.package.json' : 'fixture.json'), '{}');
  }

  executable(join(fakeBin, 'uname'), `#!/bin/sh
printf '%s\n' "\${FAKE_UNAME:-Linux}"
`);
  executable(join(fakeBin, 'cygpath'), `#!/bin/sh
mode="$1"
shift
test "$1" = --
shift
case "$mode:$1" in
  -m:/windows/*) printf 'C:%s\n' "\${1#/windows}" ;;
  *) printf '%s\n' "$1" ;;
esac
`);
  executable(join(fakeBin, 'rustc'), `#!/bin/sh
test "$1" = -vV
printf '%s\n' 'rustc 1.94.0' 'host: fake-host'
`);
  executable(join(fakeBin, 'wasm-tools'), `#!/bin/sh
if [ "\${1:-}" = --version ]; then printf 'wasm-tools %s\n' "\${WASM_TOOLS_VERSION:-1.254.0}"; exit 0; fi
test "$1" = component
test "$2" = new
test "$4" = -o
cp "$3" "$5"
printf 'wasm-tools %s -> %s\n' "$3" "$5" >>"$TOOL_LOG"
`);
  executable(join(fakeBin, 'cargo'), `#!/bin/sh
printf 'cargo %s\n' "$*" >>"$TOOL_LOG"
if [ "\${1:-}" = metadata ]; then
  printf '{"target_directory":"%s/target-output"}\n' "$TEST_ROOT"
  exit 0
fi
target=
previous=
for argument do
  if [ "$previous" = --target ]; then target="$argument"; fi
  previous="$argument"
done
if [ "$target" = fake-host ]; then
  mkdir -p "$TEST_ROOT/target-output/fake-host/release"
  case "$FAKE_UNAME" in MINGW*|MSYS*|CYGWIN*) name=pump.exe ;; *) name=pump ;; esac
  printf '%s\n' host >"$TEST_ROOT/target-output/fake-host/release/$name"
elif [ "$target" = wasm32-unknown-unknown ]; then
  output="$TEST_ROOT/target-output/wasm32-unknown-unknown/release"
  mkdir -p "$output"
  for name in author runtime pattern style_calm style_bold song_a song_b chart_author chart_runtime song_correlated; do
    printf '%s\n' ordinary >"$output/pump_\${name}_component.wasm"
  done
  case " $* " in
    *test-failure*) printf '%s\n' fixture >"$output/pump_pattern_component.wasm" ;;
  esac
  case " $* " in
    *test-recovery*) printf '%s\n' fixture >"$output/pump_song_a_component.wasm" ;;
  esac
fi
`);
  executable(join(fakeBin, 'node'), `#!/bin/sh
if [ "\${1:-}" = -e ]; then exec "$REAL_NODE" "$@"; fi
printf 'node:%s\nPUMP_BINARY=%s\nPUMP_BUNDLE=%s\n' "$*" "\${PUMP_BINARY:-}" "\${PUMP_BUNDLE:-}" >>"$RUN_LOG"
`);
  executable(join(fakeBin, 'docker'), `#!/bin/sh
: >"$DOCKER_LOG"
exit 99
`);

  assert.equal(existsSync(join(project, 'dist')), false);
  const versionFailure = invoke('scripts/build.sh', [], { WASM_TOOLS_VERSION: '0.0.0' }, 1);
  assert.match(versionFailure.stderr, /wasm-tools 1\.254\.0 is required, but found: wasm-tools 0\.0\.0/);
  assert.equal(existsSync(join(project, 'dist')), false);
  invoke('scripts/build.sh');
  assert.equal(readFileSync(join(project, 'dist', 'pump.exe'), 'utf8'), 'host\n');
  assert.equal(readFileSync(join(project, 'dist', 'pattern.component.wasm'), 'utf8'), 'ordinary\n');
  assert.equal(readFileSync(join(project, 'dist', 'fixture-pattern-failure.component.wasm'), 'utf8'), 'fixture\n');
  assert.equal(readFileSync(join(project, 'dist', 'song-a.component.wasm'), 'utf8'), 'ordinary\n');
  assert.equal(readFileSync(join(project, 'dist', 'fixture-song-recovery.component.wasm'), 'utf8'), 'fixture\n');
  assert.ok(existsSync(join(project, 'dist', 'feedback', 'fixture.json')));
  assert.ok(existsSync(join(project, 'dist', 'package-feedback', 'fixture.json')));
  assert.match(readFileSync(toolLog, 'utf8'), /cargo build --locked --release --target fake-host -p pump/);
  assert.equal(existsSync(dockerLog), false);

  invoke('scripts/build.sh', [], { FAKE_UNAME: 'Linux' });
  assert.equal(readFileSync(join(project, 'dist', 'pump'), 'utf8'), 'host\n');
  assert.equal(existsSync(join(project, 'dist', 'pump.exe')), false);
  assert.equal(existsSync(dockerLog), false);

  const pump = `#!/bin/sh
printf '<%s>\n' "$@" >>"$RUN_LOG"
`;
  executable(join(project, 'dist', 'pump.exe'), pump);
  invoke('scripts/run.sh', ['pump', 'argument with spaces', 'literal;$HOME*'], { PUMP_RUN_CONTAINER: '1' });
  assert.equal(readFileSync(runLog, 'utf8'), '<argument with spaces>\n<literal;$HOME*>\n');
  assert.equal(existsSync(dockerLog), false);

  mkdirSync(join(project, 'custom'));
  executable(join(project, 'custom', 'pump.exe'), pump);
  writeFileSync(runLog, '');
  invoke('scripts/run.sh', ['pump', '--help'], { PUMP_BINARY: 'custom/pump.exe' });
  assert.equal(readFileSync(runLog, 'utf8'), '<--help>\n');

  invoke('scripts/run.sh', ['pump', '--help'], { PUMP_BINARY: 'missing/pump.exe' }, 127);
  assert.equal(existsSync(dockerLog), false);

  writeFileSync(runLog, '');
  invoke('scripts/run.sh', ['stepmania', '--out', 'bundle/output with spaces']);
  assert.match(readFileSync(runLog, 'utf8'), /node:scripts\/prepare-stepmania\.mjs --out bundle\/output with spaces/);

  writeFileSync(runLog, '');
  invoke('scripts/run.sh', ['serve'], { PUMP_BUNDLE: '/windows/bundle' });
  assert.match(readFileSync(runLog, 'utf8'), /node:app\/server\.mjs/);
  assert.match(readFileSync(runLog, 'utf8'), /PUMP_BINARY=dist\/pump\.exe/);
  assert.match(readFileSync(runLog, 'utf8'), /PUMP_BUNDLE=C:\/bundle/);

  executable(join(project, 'scripts', 'test-ssc-parser.sh'), '#!/bin/sh\nprintf parser >>"$RUN_LOG"\n');
  executable(join(project, 'scripts', 'test-e2e-internal.sh'), '#!/bin/sh\nprintf internal >>"$RUN_LOG"\n');
  writeFileSync(runLog, '');
  invoke('scripts/run.sh', ['test-e2e']);
  assert.equal(readFileSync(runLog, 'utf8'), 'parserinternal');
  assert.equal(existsSync(dockerLog), false);

  writeFileSync(toolLog, '');
  for (const mode of ['all', 'fmt', 'lint', 'unit']) invoke('scripts/check.sh', mode === 'all' ? [] : [mode]);
  const checks = readFileSync(toolLog, 'utf8');
  assert.match(checks, /cargo fmt --all -- --check/);
  assert.match(checks, /cargo clippy --locked --workspace --all-targets --all-features -- -D warnings/);
  assert.match(checks, /cargo test --locked --workspace/);
  assert.equal(existsSync(dockerLog), false);

  const justfile = readFileSync(join(root, 'justfile'), 'utf8');
  assert.match(justfile, /^build-docker:/m);
  assert.match(justfile, /^check-docker:/m);
  for (const name of ['build.sh', 'check.sh', 'run.sh', 'test-e2e.sh']) {
    assert.doesNotMatch(readFileSync(join(root, 'scripts', name), 'utf8'), /docker_cmd|PUMP_RUN_CONTAINER/);
  }
  console.log('Native workflow regression passed.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
