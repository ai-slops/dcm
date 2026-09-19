# Implementation status

## Implemented

- Rust author component on `wasm32-unknown-unknown` using a host-owned WIT `builder` resource.
- Backward-only node references, pre-allocation budgets, checked arithmetic, unique semantic IDs, provenance, and canonical host plan.
- Tap, sequence, collision-free parallel, bounded repeat, weighted choice, explicit scopes, mirror, and simple same/different relations.
- Manual versioned runtime-plan and command-trace codecs.
- Import-free generic runtime component and real synchronous Wasmtime execution from the CLI.
- SHA-256 path-addressed PRF with rejection sampling and no global random state.
- Bundle manifest, lock digest, structural analysis report, integrity verification, compiler policy version checks, and request seed/plan/runtime binding.
- Import/export inspection, no WASI linker, fuel, memory/table/instance limits, hostcall budget, and disabled thread/shared-memory/SIMD features.
- Unit, property, sandbox fuel, import rejection, tamper, determinism, seed-variation, and end-to-end tests.

## Deliberately deferred

- Cryptographic publisher signatures, transparency logs, and trusted release policy. Current hashes prove integrity only.
- A local content-addressed artifact cache.
- Package composition/linking between third-party components.
- Full exact-path rule enumeration and a complete 42-section design. Current constraints are structural and universal; no general symbolic constraint language exists.
- Evidence schemas, IntentPoint matching and credit policies, difficulty envelopes, holds, foot-state execution paths, and history-aware generation.
- Tempo maps, audio-resource binding, package locks, capability resolution, source-normalizing canonicalization, ranked modes, and optimizer passes.
- Calibrated official difficulty levels, physical safety claims, exact distribution certification, ranked signatures, and platform certification.
- External package/network access inside components, WASI, asynchronous components, and streaming play. Generation is intentionally complete-before-play. The separate DIM development gateway exposes only health and bounded generation endpoints.

The built-in author is an example exercising the stage-1 contracts, not a claim of official chart calibration.
