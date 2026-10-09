# Build, validation, and Windows line endings

## Prerequisites

- Docker with Linux containers for the pinned Rust toolchain. Host Rust is not required.
- Node.js 24 for the gateway, preparation helpers, and end-to-end tests.
- Git for checkout and the line-ending regression test.
- [just](https://just.systems/man/en/installation.html) for command shortcuts. Install it inside
  the Linux/WSL environment where you run the recipes. On distributions that package it, use the
  distribution's `just` package; otherwise use the official installation options. The recipes
  were exercised with just 1.43.1.

The application binary produced by this project is Linux-only. On Windows, use WSL2 and Docker
Desktop's WSL integration. A Windows Git checkout can still supply Docker's sources, and the
attributes below protect it, but installing native Windows just does not make the Linux CLI or
POSIX shell recipes native-Windows programs. Run the full workflow inside WSL.

## Daily commands

Run `just` or `just --list` for help. Commands run from the repository root even when invoked from
a subdirectory. Arguments to `pump` and `stepmania` are forwarded as separate, quoted arguments;
paths and titles containing spaces are supported.

| Command | What it does | Rebuilds `dist`? |
| --- | --- | --- |
| `just build` | Release CLI/WASM compilation, componentization, example/test-fixture packaging | Yes |
| `just check` | Rust fmt check, Clippy with `-D warnings`, and workspace tests in Docker | No |
| `just fmt-check` | Non-mutating Rust format check in Docker | No |
| `just lint` | Clippy in Docker | No |
| `just test-unit` | Rust workspace tests in Docker | No |
| `just check-eol` | Real Git checkout regression with Windows line-ending settings | No |
| `just test-e2e` | All existing CLI/package/store/SSC/StepMania/gateway integration scenarios | No; build first |
| `just test` | Checkout regression, Rust checks, fresh build, then all E2E tests | Yes |
| `just pump --help` | Run the built CLI; any subsequent arguments are forwarded | No |
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
```

`Dockerfile` has a `source` target used by `scripts/check.sh`, a `builder` stage that compiles,
and the final runtime stage. The check command builds a source snapshot and executes checks in
a disposable container. No host source mounts are needed, so a remote Docker daemon also works.
Standalone checks do not populate `dist`. Docker source-image caching is not a persistent Cargo
test cache; separate check invocations may repeat compilation. There is no new host Rust dependency.

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
test. The application and existing integration suite still require Linux/WSL.
