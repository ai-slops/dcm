# Executable architecture

## Preserved v1 boundary

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

`components/author` is the backward-compatible raw authoring example. It cannot submit a serialized Plan or access WASI. The host owns one builder per invocation and accepts only backward node references. Its guest-provided provenance is a diagnostic source label, not authenticated evidence of authorship or musical intent. The additional package path uses role-specific worlds, shared session budgets, private builder views, and host-authored package provenance; see [local package format](package-format.md).

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

V1 generation binds the exact plan, seed, and runtime digest in CLI output, and returns a generated trace digest. Only double ten-panel mode is supported. V1 has no history input; repeated requests with the same supported inputs are replay-identical.

## Additive feedback-grade v2 boundary

`pump chart` uses separate `pump-chart` types and binary codecs, `pump-eval` model evaluation,
and a versioned `pump:chart` WIT world. It adds holds, rests, exact tempo/audio time, finite
two-foot execution, concrete-note intent evidence, difficulty envelopes, full retained-candidate
verification, recent-history sampling, and optional trusted signatures without changing v1.

The compiler exhaustively enumerates the supported finite Plan, merges equal normalized musical
traces, evaluates every candidate, and records all rejection witnesses and exact removed prior mass.
The runtime receives only the retained weighted candidate table. The host compares each generated
response with the native reference selector, including probability and history metadata.

Schema-2 bundles contain the canonical author Plan, compile limits, evaluation contract, runtime
table/component, and report. `chart verify` reproduces the complete evaluation, not merely the file
hashes. Ed25519 authenticity requires an externally supplied trusted key. See
[chart v2](chart-v2.md) and [the evaluation model](evaluation-v2.md) for limits and exact claims.

## Runtime and build limits

The Wasmtime feature set excludes threads and shared memory. SIMD is disabled in engine configuration. Fuel controls guest instructions; hostcall counts and structural/string/edge caps bound builder work. One linear memory is allowed, so the 64 MiB per-memory bound is also the aggregate linear-memory bound. Wasmtime compiler allocation and all host-process memory are not covered by that limit.

The CLI is a development tool, not an internet multi-tenant compiler service. It does not provide epoch interruption of compilation or process-wide memory isolation. Use an OS/container resource boundary for adversarial production workloads. The DIM gateway never accepts arbitrary components or paths from clients, and limits generator subprocess duration and concurrency.

## Extension points and limits

The initial IR is already PUMP-specific at its tap boundary. Locally locked v1 pattern/style components compose through the host registry; the additive v2 author has its own operations. General capability-based game adapters, nested dependency graphs, fragment caches, richer metric plugins, and empirical difficulty calibration remain future work. V2 evidence comes from actual notes and bound annotations, not provenance strings.

V1 remains `development`. V2 emits `exact-within-declared-model` for the finite retained candidate set. Neither path claims official ranked approval or human physical safety. Cross-architecture determinism is a design goal backed by integer-only semantics and golden tests, not a claim that ARM64 or macOS has been tested in this workspace.
