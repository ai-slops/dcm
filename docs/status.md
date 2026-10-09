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
- Strict schema-1 local package manifests and deterministic exact locks for song, pattern, and style roles.
- Two independently compiled song bundles dispatching the same external pattern digest and distinct import-free style policies through a trusted host registry.
- Store-local builder views over one bounded shared session, stable host-authored provenance, cumulative child fuel, registry quotas, mutation poisoning, and versioned invocation reports.
- Local SHA-256 component storage with bounded verified reads, no-clobber publication, shared-blob reuse, and lock-only compilation without original source files.

## Feedback-grade v2

The v2 `pump chart` path additionally implements all six feedback-grade domains:

- Hold intervals, rests, same-tick releases, and canonical logical-demand grouping.
- Exact rational tempo maps, signed audio offsets, reference accents, and audio SHA-256 binding.
- Exhaustive finite two-foot projections, bracket catalogs, hold ownership, travel clocks, alternatives, and infeasible-frame witnesses.
- Concrete-note evidence for accents, silence and relational motifs, with bounded exact exclusive/shared credit allocation.
- Tempo-aware rule difficulty, local windows, all-feasible-path bounds, complete candidate enumeration/pruning, and rejection probability accounting.
- Deterministic history-conditioned sampling, explicit exhaustion fallback, reproducible schema-2 certificates, and externally anchored Ed25519 signatures.
- Exact bounded package-to-feedback conversion from source or CAS, preserving v1 correlated choice distributions and retaining signed, reproducible source provenance.
- Bounded SSC 0.83 notes/timing export for supported pump-double charts, with exact chart/music replay descriptors, verified WASM selection, byte-bound WAV/OGG/MP3 copying, optional explicit signature trust, and no-clobber output directories.

## Deliberately deferred

- Public publisher identity/revocation infrastructure, transparency logs, and official ranked release policy. Local v2 signature verification is implemented; hashes alone still prove only integrity.
- Native compilation caches, generic Plan-fragment caches, and store garbage collection.
- Network package discovery, nested/transitive package graphs, and publisher authenticity.
- Large symbolic generation spaces beyond the explicit finite v2 profile, arbitrary metric plugins, and a general constraint language.
- Extensible evidence-schema registries and richer artist-specific intent detectors beyond the three built-in families.
- General cross-game capability resolution, source-normalizing canonicalization, ranked modes, and optimizer passes.
- Calibrated official difficulty levels, physical safety claims, exact distribution certification, ranked signatures, and platform certification.
- External package/network access inside components, WASI, asynchronous components, and streaming play. Generation is intentionally complete-before-play. The separate DIM development gateway exposes only health and bounded generation endpoints.

Both v1 and v2 authors are examples of their declared contracts, not claims of official chart calibration. See `chart-v2.md` and `evaluation-v2.md` for the supported v2 model and workflow.
