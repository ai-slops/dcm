# Build, validation, and Windows line endings

## Prerequisites

- Docker with Linux containers for the pinned Rust toolchain. Host Rust is not required.
- Node.js 24 on the host for checkout/fixture helpers; the Windows runner also includes Node 24
  for preparation, gateway, and E2E processes.
- Git for checkout and the line-ending regression test.
- [just](https://just.systems/man/en/installation.html) for command shortcuts. On Windows, install
  its Windows binary and run it from Git Bash. On distributions that package it, use the
  distribution's `just` package; otherwise use the official installation options. The recipes
  were exercised with just 1.43.1.

**Windows requires Git Bash and Docker Desktop in Linux-container mode, not a WSL shell.** The
build produces a Linux binary, but the Windows recipes execute it inside Docker rather than on
the Windows host. Docker Desktop may itself use WSL2 or Hyper-V as its backend; this project does
not require a WSL distribution, a Linux checkout, or entering WSL to run its commands.

In Git Bash, confirm `sh`, `git`, `node`, `just`, and `docker` are on PATH and `docker version`
can reach the engine. For example, install just with `winget install --id Casey.Just --exact`
and reopen Git Bash. Do not execute `./dist/pump` directly on Windows; use `just pump`.

```sh
just build
just pump --help
just stepmania --out "bundle/Windows playtest"
just test
```

The generated files are written back to that same Windows checkout through a Docker bind mount.
No Windows `.exe` is cross-compiled. Native Linux keeps the existing direct execution path.

## Daily commands

Run `just` or `just --list` for help. Commands run from the repository root even when invoked from
a subdirectory. Arguments to `pump` and `stepmania` are forwarded as separate, quoted arguments;
paths and titles containing spaces are supported.

| Command | What it does | Rebuilds `dist`? |
| --- | --- | --- |
| `just build` | Release CLI/WASM compilation, componentization, runtime/runner images and fixtures | Yes |
| `just check` | Rust fmt check, Clippy with `-D warnings`, and workspace tests in Docker | No |
| `just fmt-check` | Non-mutating Rust format check in Docker | No |
| `just lint` | Clippy in Docker | No |
| `just test-unit` | Rust workspace tests in Docker | No |
| `just check-eol` | Real Git checkout regression with Windows line-ending settings | No |
| `just test-e2e` | All existing CLI/package/store/SSC/StepMania/gateway integration scenarios | No; build first |
| `just test` | Checkout/dispatch regressions, Rust checks, fresh build, then all E2E tests | Yes |
| `just pump --help` | Run the CLI natively on Linux or in Docker on Windows; forward arguments | No |
| `just stepmania --out "bundle/my playtest"` | Prepare the two-song demo, or forward custom bundle options | No; build first |
| `just serve` | Run the v1 development HTTP gateway in the foreground | No; needs its configured bundle |

Typical use:

```sh
just build
just stepmania --out "bundle/my playtest"
just test
```

`just build` does not run Clippy, formatting checks, or tests. Clippy is a static quality checker,
not a requirement for compiling artifacts, so lint policy should not block a routine build.
The full validation gate still enforces the same checks; this separation is not a relaxation of
the policy for reviewed changes. Rustfmt and Clippy remain installed in the shared toolchain so
the validation commands use the same pinned version as the compiler.

Without just, use:

```sh
sh scripts/build.sh
sh scripts/check.sh             # optional argument: all, fmt, lint, or unit
sh scripts/test-e2e.sh          # existing artifacts only
sh scripts/test.sh              # complete validation
sh scripts/run.sh pump --help
sh scripts/run.sh stepmania --out "bundle/my playtest"
sh scripts/run.sh serve
```

`Dockerfile` has a `source` target used by `scripts/check.sh`, a `builder` stage that compiles,
a compact `runtime` stage, and a digest-pinned Node 24 `runner` stage. The default/final image
remains the compact runtime. `just build` tags both `pump-toolchain:0.1.0` and
`pump-runner:0.1.0`, then extracts the runtime artifacts into `dist`.
The check command builds a source snapshot and executes checks in a disposable container.
Build/check do not need host source mounts, so they also work with a remote Docker daemon.
Standalone checks do not populate `dist`. Docker source-image caching is not a persistent Cargo
test cache; separate check invocations may repeat compilation. There is no new host Rust dependency.

## Runtime paths and Docker behavior

`scripts/run.sh` selects Docker when Git Bash reports MINGW/MSYS/CYGWIN, or when
`PUMP_RUN_CONTAINER=1` is set explicitly. Otherwise Linux continues using host Node and `dist/pump`.
Docker mode mounts the repository at `/workspace` and runs the packaged `/opt/pump/pump`, so it
does not depend on a Windows filesystem preserving the extracted ELF's executable permission.

Use **repository-relative paths** in Windows commands:

```sh
just stepmania --bundle inputs/chart.bundle --audio inputs/music.wav \
  --out "bundle/my song" --title "My song" --artist "My artist"
```

Copy external inputs into the checkout first. `C:/outside/music.wav`, `C:\outside\music.wav`,
`/c/outside/music.wav`, and host `/tmp` paths are not automatically mounted or translated. Absolute
container paths under `/workspace` are also usable. Keep outputs under that mount; files written
elsewhere in the disposable container are not retained. Linux native mode still accepts its
ordinary host absolute paths. Metadata strings are not interpreted as paths or shell commands.

The Docker helper converts host checkout/copy paths with `cygpath -m` and disables MSYS path
rewriting **only for Docker subprocesses**. Do not globally export conversion overrides: other
Windows tools may need Git Bash's normal conversion. If Docker Desktop prompts to share the
checkout drive/folder, allow the intended project folder. The runner has read/write access to the
checkout, but does not mount the Docker socket or the rest of the host filesystem.

Runtime containers need the daemon to see the checkout at the supplied host path. Unlike
build/check, this is not transparent with a remote daemon. A preflight fails with a shared-path
diagnostic if the checkout is invisible. Linux users of remote Docker retain their native runtime
path; forced container tests require a daemon-visible shared directory. Forced Linux containers
use the host UID/GID; rootless daemons may additionally remap IDs, so the shared directory must
have appropriate access permissions.

The complete E2E dispatcher keeps Docker orchestration on the host. The independent SSC parser
runs in its own UV/Python container, and the remaining suite runs in the Node runner on Windows.
There is no Docker-in-Docker requirement. Parser execution restores `dist/pump`'s executable bit
inside Linux after copying it from Windows. A host `PUMP_BINARY` override applies to native Linux
execution; the container runtime deliberately uses its packaged binary instead.

For the development gateway, compile a v1 bundle, then run:

```sh
just pump compile dist/author.component.wasm --runtime dist/runtime.component.wasm \
  --out bundle/gateway
PUMP_BUNDLE=bundle/gateway just serve
```

The container gateway is published at `http://127.0.0.1:3000` by default. In container mode,
`PUMP_PORT=3001` changes the host port, while `PUMP_BUNDLE` must be repository-relative or under
`/workspace`. Stop it with Ctrl+C. These are not an authenticated public deployment recipe.

## Why `.gitattributes` is necessary

With `core.autocrlf=true`, a Windows Git checkout normally expands LF text to CRLF. Docker `COPY`
preserves those bytes. Linux shells may then read a CR character as part of the shebang or command,
and formatting checks may reject the source. This is independent of whether the Docker engine
itself runs Linux.

The repository policy is `* text=auto eol=lf`: recognized text is normalized and checked out as
LF regardless of the user's autocrlf setting. Explicit binary rules preserve bytes for WASM,
binary plans/programs, audio, and common archive/image formats. The policy also covers `.dim`
shell files without editing any `.dim` file. Do not change your global Git configuration to work
around this project.

### Existing checkout already contains CRLF

Pulling a new `.gitattributes` file does **not** necessarily rewrite unchanged files already on
disk. The safest solution is a fresh clone into a different directory at `development` or the
branch containing this fix. Keep the old directory until all local work has been transferred.

To refresh the existing checkout instead:

1. Save or commit all local changes first, including staged changes. Check `git status --short`.
   Proceed only when it prints nothing. Do not use the next command to discard work.
2. Ensure the `.gitattributes` fix is committed in your checkout, then ask Git to rewrite tracked
   files from its index using the new attributes:

   ```sh
   git checkout-index --force --all
   ```

   This overwrites tracked working-tree files; it is only appropriate after step 1. Untracked
   generated output is not refreshed. No such refresh is run automatically by the build scripts.
3. Inspect the relevant files:

   ```sh
   git ls-files --eol Dockerfile justfile scripts/build.sh scripts/test.sh
   just check-eol
   just build
   ```

   Text should report `i/lf` and `w/lf`, with `eol=lf` attributes. If an editor subsequently saves
   a shell script as CRLF, change that editor's line-ending mode to LF before rebuilding.

`git add --renormalize .` only normalizes the index; it is not, by itself, a repair for CRLF bytes
already in the working tree. Do not stage the whole repository merely to make a local build work.

## Validation scope

The regression creates a disposable Git repository, enables `core.autocrlf=true` and `core.eol=crlf`
per command, and checks the actual checkout bytes for shell/Rust/build files and binary fixtures.
It does not modify the current repository's Git configuration or use a destructive checkout here.
This exercises Git's Windows conversion settings on Linux; it is not a native Windows execution
test. `scripts/test-docker-runtime.sh` additionally tests MINGW dispatch, Windows path construction,
conversion overrides, argument boundaries, exit propagation, and parser permission recovery using
command doubles. Real Docker execution was exercised through a daemon-visible shared checkout,
including generation, persisted output, the E2E suite, and gateway HTTP requests. No physical
Windows/Docker Desktop machine was available here; that last platform-specific smoke test remains
necessary before claiming native Windows environment validation.
