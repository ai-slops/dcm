# Local package format

Stage 2 adds an offline, project-relative package resolver without changing the stage-1 author or runtime ABIs. Source manifests are strict JSON with `schema_version: 1`, exactly one `song`, and at most 16 package records. Every record has an exact three-part numeric version, role, relative component path, public exports, contract, capabilities, and dependencies. Unknown fields, parent or absolute paths, symbolic-link path components, duplicate keys, names or per-package exports, unsupported capabilities, nested pattern/style dependencies, and manifests larger than 256 KiB are rejected. Different packages may publish the same role's export. Schema v1 fixes the public export to `build`, `render`, or `policy` for song, pattern, or style respectively.

The resolver reads each component once, caps each artifact at 32 MiB and the set at 128 MiB, then emits a path-independent lock sorted by key. The lock records exact name, version, role, SHA-256, exports, contract, capabilities, and dependencies. A song must depend on every and only the locked leaf packages. Schema v1 intentionally rejects nested leaf dependencies; it does not claim general transitive resolution.

```sh
pump package resolve song-a.package.json --out song-a.lock.json
pump package compile song-a.package.json \
  --lock song-a.lock.json \
  --runtime runtime.component.wasm \
  --out song-a.bundle
pump package compatible old.lock.json new.lock.json --key pattern
```

Compilation requires the supplied lock to equal a fresh resolution, compiles the already-hashed bytes, and dispatches only by locked key and declared export. All locked components receive import and structural export-type checks before song execution, including unused leaves. Pre-instantiation linker checks alone do not validate exported function signatures in Wasmtime 40, so the closed v1 ABI is checked explicitly as well. Compatibility compares role, contract, exports, capabilities, and dependencies. A changed binary is compatible only after an explicit lock update; compatibility does not update a lock automatically. Compatibility is a schema check, not proof of musical equivalence.

## Component roles

- Song components import `operations`, `lifecycle`, and `registry`, and export `song.build`.
- Pattern components import only `operations`, receive a borrowed store-local builder view, truthfully describe their `pump.pattern/v1` contract and capabilities, and export `render`.
- Style components import nothing, describe `pump.style/v1`, and return typed weights plus mirror permission. They cannot mutate a builder.
- Runtime components remain import-free and unchanged.

The host creates a fresh 32 MiB child store for each pattern/style call. The root has 5 million fuel and all child calls share one cumulative 5 million fuel pool; only one child is active, so root plus child linear-memory limits are at most 64 MiB. Core node, edge, depth, expansion, and string limits and the global 50,000-hostcall budget are shared. Registry attempts are capped at 64. Store-local resource representations are never copied: child views map local handles to shared core node IDs, and the parent receives only an alias for a successful returned root.

A trap, error, invalid returned handle, or resource failure poisons the session if the child mutated it. Preflight lookup and occurrence failures consume registry quota but do not poison an unmodified session. Failed child calls also consume the shared fuel pool. Creating a builder does not reset earlier style-call accounting, and a finished builder cannot be recreated. Provenance is host-authored from the exact digest and a hash of digest/export/occurrence; semantic IDs use that same stable identity rather than call order. The invocation report maps those identities back to readable package keys and occurrences.

Bundles add `package.lock.json` and `invocations.json`. Their hashes and a separate package compiler-policy digest are optional fields in the existing schema-1 bundle manifest, so old stage-1 bundles remain readable. The package policy pins the shared fuel/memory/call limits, resolver bounds, core policy, and exact package WIT. Verification checks both files together, schema versions, report-to-lock linkage, the locked song against the bundled author, and each reported key, digest, export, occurrence, and validated style policy. Hashes establish integrity, not publisher authenticity.

`scripts/test-packages.sh` exercises two independently compiled songs sharing one pattern digest with different style digests. Both songs use style weights and mirror permission. It removes source components before generation, proving replay needs only the compiled bundle. Separate test-only component feature builds intentionally mutate then fail, and attempt to ignore the error; compilation must reject the poisoned session. These `fixture-*` artifacts are not production examples.

General network registries, nested dependency graphs, signatures, fragment caches, cross-game capability abstractions, intent/evidence scoring, and certification remain deferred.
