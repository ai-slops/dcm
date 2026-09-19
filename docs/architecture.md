# Executable architecture

## Delivered boundary

```text
Rust author source
  -> wasm32-unknown-unknown core module
  -> component with pump:author/plan-builder@0.1.0 import
  -> Wasmtime HostState / ResourceTable / bounded Builder
  -> validated Plan with stable authored decision IDs
  -> versioned RuntimePlan binary
  -> import-free runtime component in a fresh fuel-limited store
  -> versioned PUMP CommandTrace
```

`components/author` is a replaceable authoring example. It cannot submit a serialized Plan or access WASI. The host owns one builder per invocation and accepts only backward node references. Guest IDs are scoped to that builder. Guest-provided provenance is a diagnostic source label, not authenticated evidence of authorship or musical intent.

`crates/pump-core` owns composition semantics, integer sampling, binary encoding, structural analysis, and validation. The compiler rechecks metadata at the public Plan boundary. Decoding reconstructs and verifies a RuntimePlan before execution. The shared implementation compiles both natively for testing and into the generic runtime component; the production CLI always calls the component rather than substituting native generation.

`crates/pump-cli` owns Wasmtime, resource limits, artifact files, bundle policy, and JSON diagnostics. A seed sweep reuses compiled machine code but isolates every generation in a new store. No package resolver, author execution, or compiler is needed inside the runtime component.

## Bundle

| File | Purpose |
| --- | --- |
| `runtime-plan.bin` | Versioned ordered generation data |
| `runtime.component.wasm` | Exact runtime implementation |
| `author.component.wasm` | Build provenance, unused during generation |
| `analysis.json` | Structural counts and conservative expansion bounds |
| `manifest.json` | Digests, supported mode, ABI versions, compiler policy |
| `manifest.lock.json` | Exact manifest digest |

Readers reject oversized or non-regular artifact paths, mismatched digests, unsupported versions/policy, and invalid runtime plans. `verify` checks integrity and data validity, not publisher trust or a universal physical-safety certificate. A lock stored alongside its artifacts cannot authenticate them against an attacker who replaces the whole directory. The caller must trust the runtime digest or use a future signed distribution channel.

Generation binds the exact plan, seed, and runtime digest in CLI output, and returns a generated trace digest. Only double ten-panel mode is supported. There is no history input; repeated requests with the same supported inputs are replay-identical.

## Runtime and build limits

The Wasmtime feature set excludes threads and shared memory. SIMD is disabled in engine configuration. Fuel controls guest instructions; hostcall counts and structural/string/edge caps bound builder work. One linear memory is allowed, so the 64 MiB per-memory bound is also the aggregate linear-memory bound. Wasmtime compiler allocation and all host-process memory are not covered by that limit.

The CLI is a development tool, not an internet multi-tenant compiler service. It does not provide epoch interruption of compilation or process-wide memory isolation. Use an OS/container resource boundary for adversarial production workloads. The DIM gateway never accepts arbitrary components or paths from clients, and limits generator subprocess duration and concurrency.

## Extension points and limits

The initial IR is already PUMP-specific at its tap boundary. General capability-based game adapters, reusable separately linked pattern/style components, evidence/intent semantics, embodiment paths, and calibrated difficulty require subsequent implementation. Keeping these explicitly absent is preferable to treating provenance strings as intent evidence or labeling note counts as a calibrated difficulty model.

No `bounded`, `exact`, or `ranked` certificate is emitted. The sole manifest certification value is `development`. Cross-architecture determinism is a design goal backed by integer-only semantics and golden tests, not a claim that ARM64 or macOS has been tested in this workspace.
