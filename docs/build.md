# Native build, validation, and optional Docker

**The default workflow does not use Docker.** `just build`, `check`, `test`, `pump`, `stepmania`,
and `serve` use tools and executables on your host. Windows uses Git Bash and a native MSVC Rust
toolchain; neither WSL nor Docker Desktop is required. Docker remains an explicit, optional way
to reproduce the Linux build and Rust checks.

## 1. Install the host prerequisites

Install Git, [Node.js 24](https://nodejs.org/en/download),
[Rust via rustup](https://rustup.rs/), and [just](https://just.systems/man/en/installation.html).
The independent SSC parser additionally needs [uv](https://docs.astral.sh/uv/getting-started/installation/)
and Python 3.12. Python/uv are required for the full test suite, not for building or generating songs.

### Windows

1. Install Git for Windows with Git Bash.
2. Install Visual Studio 2022 Build Tools with **Desktop development with C++**, the MSVC v143
   tools, and a Windows SDK. Git Bash alone does not provide the native compiler/linker.
3. Install Rust using its **MSVC** host toolchain, normally `x86_64-pc-windows-msvc` on x64 Windows.
   See [Rust's MSVC prerequisites](https://rust-lang.github.io/rustup/installation/windows-msvc.html).
4. Install Node.js 24 and just, then reopen Git Bash so their executables are on PATH.
   For example, `winget install --id Casey.Just --exact` installs the command runner.
5. Run the commands below from Git Bash. If Cargo cannot locate `link.exe` or the Windows SDK,
   repair the C++ Build Tools installation or launch Git Bash from the Visual Studio developer
   command prompt. Do not switch to a Linux toolchain as a workaround.

### Linux

Install a native C/C++ compiler and system development headers in addition to Rust. For example,
on Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config
```

If Cargo is not on PATH after rustup installation, reopen the shell or source `$HOME/.cargo/env`.
No Docker daemon or host container runtime is needed.

### Pinned Rust and WASM tools

From the checkout:

```sh
rustup toolchain install 1.94.0 --profile minimal
rustup component add --toolchain 1.94.0 rustfmt clippy
rustup target add --toolchain 1.94.0 wasm32-unknown-unknown
cargo +1.94.0 install --locked wasm-tools --version 1.254.0
wasm-tools --version
```

`rust-toolchain.toml` also declares the Rust version, components, and WASM target. The build checks
that `wasm-tools --version` reports exactly `wasm-tools 1.254.0`; it fails with guidance rather than
silently installing tools, changing versions, or falling back to Docker. A published native
`wasm-tools` 1.254.0 binary is also acceptable if it is on PATH.

For the full validation suite:

```sh
uv python install 3.12
```

The parser wrapper selects Python 3.12 explicitly and uses the dependencies declared in its
PEP 723 script. uv may download/cache the interpreter and packages on first use. Existing caches
allow later runs without repeating installation. No Python package is added to the Rust runtime.

## 2. Daily commands

Run `just` or `just --list` for help. Recipes run from the repository root, and arguments to
`pump` and `stepmania` preserve spaces and shell metacharacters.

| Command | Behavior | Docker? |
| --- | --- | --- |
| `just build` | Native release CLI, WASM components, fixture artifacts, and example metadata | No |
| `just check` | Host Rust fmt check, Clippy with `-D warnings`, and workspace tests | No |
| `just fmt-check` | Non-mutating host format check | No |
| `just lint` | Host Clippy | No |
| `just test-unit` | Host Rust workspace tests | No |
| `just check-eol` | Git checkout line-ending regression | No |
| `just test-e2e` | Existing-artifact CLI/package/store/SSC/StepMania/gateway tests | No |
| `just test` | Checkout/native-workflow regressions, Rust checks, fresh build, all E2E | No |
| `just pump --help` | Run the native CLI | No |
| `just stepmania --out "bundle/my playtest"` | Prepare songs with host Node and the native CLI | No |
| `just serve` | Run the development HTTP gateway in the foreground | No |
| `just build-docker` | Build the optional Linux image and extract `dist/docker` | Yes, explicit |
| `just check-docker` | Run the Rust quality checks in the pinned Linux source image | Yes, explicit |

Typical use on Windows Git Bash or Linux:

```sh
just build
just pump --help
just stepmania --out "bundle/my playtest"
just test
```

`just build` does not run formatting checks, Clippy, or tests. They remain part of `just check`
and `just test`. `just test-e2e` intentionally uses existing artifacts, so run the build first.
The shell entry points work without just:

```sh
sh scripts/build.sh
sh scripts/check.sh             # all, fmt, lint, or unit
sh scripts/test.sh
sh scripts/run.sh pump --help
sh scripts/run.sh stepmania --out "bundle/my playtest"
```

## 3. Native artifacts and paths

The native CLI is `dist/pump.exe` on Windows and `dist/pump` elsewhere. The scripts select the host
name; they do not try to run a stale Linux artifact on Windows or automatically start a container.
`PUMP_BINARY` can select another native executable for development. Relative overrides resolve
from the calling working directory; just recipes first move to the repository root.

The build reads Cargo metadata's `target_directory`, including `CARGO_TARGET_DIR`, and compiles
the CLI with Rust's explicit host triple. This prevents an unrelated Cargo default-target setting
from publishing the wrong executable. WASM components always use `wasm32-unknown-unknown`.
Normal components are packaged before intentional failure/recovery fixture builds, so fixture
features do not replace normal published components.

Host paths are supported, including paths outside the repository. Quote paths containing spaces.
When passing a path directly to a Node command on Windows, use native `C:/...` notation. Git Bash
shell entry points translate POSIX-style `PUMP_BINARY` and `PUMP_BUNDLE` paths for native programs.
Preparation metadata uses portable forward-slash relative paths inside exported packages.

The old automatic container runner and `PUMP_RUN_CONTAINER` switch have been removed. Native
executables depend on the host's runtime libraries; the optional Docker image remains a separate
pinned Linux environment rather than a portability guarantee for a copied native executable.

## 4. Windows signing and filesystem boundaries

Native chart generation, verification, signing with an existing key, and export do not require
Unix file permissions. **`pump chart keygen` still refuses to create keys on non-Unix platforms**:
the current implementation cannot atomically enforce an owner-only Windows DACL. It does not
silently write secret material with inherited permissions. Generate a real key on a supported
Unix system and protect it with appropriate Windows ACLs before using it on Windows, or defer
signing; unsigned development export does not require keygen.

Tests explicitly check that Windows keygen rejects without creating files, then use deterministic
test-only keys to retain signing, wrong-key, tamper, and signature-verification coverage. Never use
these public test fixtures as release keys. Unix keygen still enforces mode 0600.

Windows symlink tests run when the OS permits symlink creation. If it requires unavailable
Developer Mode/privileges, only those symlink-specific cases report a skip; core integrity and
cryptographic tests still run. Production regular-file/no-clobber checks are unchanged.

## 5. Optional Docker workflows

Only the explicit Docker commands need Docker Desktop/Linux containers or a Docker daemon:

```sh
just build-docker
just check-docker
docker run --rm pump-runtime:0.1.0 --help
```

The optional build extracts Linux artifacts under `dist/docker`, never over `dist/pump.exe` or
the native `dist/pump`. The separate Node runner image is no longer built or used. Build/check
send the source context and copy artifacts without host bind mounts, so remote daemons remain
usable. Git Bash path-conversion handling is confined to these optional Docker scripts.

No default recipe invokes these commands when host tools are missing. Project-owned DIM Docker
and lifecycle files have been removed. `.dim/repos.yml` contains declarative repository policy
only; it is not an application prerequisite or an installed workspace runtime.

## 6. Windows line endings

`.gitattributes` sets `* text=auto eol=lf`, so text is checked out as LF even with
`core.autocrlf=true`. Explicit binary rules preserve WASM, binary plans/programs, audio, and
common archive/image bytes. Do not change your global Git configuration to work around this repo.

Pulling `.gitattributes` may not rewrite unchanged CRLF files already on disk. The safest repair
is a fresh clone into a new directory, retaining the old checkout until local work is transferred.
To refresh an existing checkout instead, first save/commit **all** local changes and confirm
`git status --short` prints nothing. Only then run:

```sh
git checkout-index --force --all
git ls-files --eol Dockerfile justfile scripts/build.sh scripts/test.sh
just check-eol
```

`checkout-index --force` overwrites tracked working-tree files and must not be used to discard
unsaved work. Expected text state is `i/lf` and `w/lf` with `eol=lf`. `git add --renormalize .`
alone changes the index, not the CRLF working-tree bytes; do not stage everything merely to build.

## Validation scope

The default full suite was run natively on Linux with a failing Docker sentinel first on PATH.
The native release build, Rust checks, independent Python parser, CLI scenarios, and gateway tests
passed without invoking Docker. Windows executable naming and Git Bash path behavior have
command-double/unit coverage, but no physical Windows MSVC build was available in this workspace.
Run `just build && just test` on the target Windows machine for that final platform-specific gate.

## Native DIM source CI

`.dim/ci/runner.yml` runs `bash scripts/ci/source.bash` in the fresh candidate
checkout. The explicit `git-ci` policy in `.dim/repos.yml` requires its successful
`source` result before protected promotion; an operator must apply that reviewed
policy to an existing DIM repository. Editing the manifest alone does not install it.

The script reuses the pinned Studio prerequisites and existing Rust/web checks.
It builds real native Studio artifacts, runs Rust formatting/Clippy/workspace tests,
web strict types/lint/tests, and the production web build. Tools and Cargo output
use a disposable temporary directory; it does not use Studio credentials, saved
charts/audio, running servers, or warmed workspace artifacts. It needs network
access to the pinned tool and package sources, plus a C compiler/curl/xz; on the
ordinary Debian/Ubuntu root job it installs missing system prerequisites with apt.
Run it only in a disposable source checkout: building replaces that checkout's
`dist` and `web/dist`. The existing authenticated external UCS browser evidence
remains separate from this source job; this job does not mutate a live Studio.
