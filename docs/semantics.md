# Stage-1 semantics

## Time and panels

Time is an unsigned integer tick. A tap has a positive spacing duration and a non-empty 10-bit panel mask. Its duration is not a hold. Bits 0 through 4 are player one's down-left, up-left, center, up-right, down-right; bits 5 through 9 use the same order for player two. Mirroring maps bit `i` to bit `9-i`, exchanging pads and reflecting left/right. A command records start tick, duration, mask, semantic decision ID, and source provenance. A tempo map and audio binding are not implemented; a game integration must provide the tick-to-music mapping.

## Composition

- `sequence` starts each child after the declared duration of its predecessor; duration is the checked sum.
- `parallel` starts every child together; duration is the maximum. The compiler rejects any overlap between the conservative panel unions of its children.
- `repeat` requires a positive bounded count and uses checked multiplication.
- `choice` requires positive integer weights. Alternatives must have equal durations unless an explicit duration is supplied; the explicit duration must cover every alternative.
- `scope` adds an explicit run, section, or phrase occurrence key to the PRF path.
- `mirror` transforms physical panel masks without changing semantic decision IDs.
- `relation same` requires equal conservative panel unions. `relation different` requires disjoint unions. A relation emits its left then right child.

Every node can only refer to earlier nodes. Budgets are checked before insertion. Semantic decision IDs are non-empty and unique, so random decisions do not depend on array position.

Scopes are authored namespaces, not implicitly inferred musical sections. Reusing the same choice node in the same occurrence scope intentionally reuses its draw. Use distinct explicit scope keys for independent motif instances. Bounded repeat adds its own semantic ID and iteration number. Empty/rest nodes, zero repeats, and fractional beat times are not yet supported.

## Determinism

Weighted choice uses SHA-256 as a path-addressed PRF over a domain separator, the 32-byte seed, length-prefixed semantic decision ID, explicit occurrence path, and rejection counter. Rejection sampling removes modulo bias. There is no mutable global PRNG and the whole trace is completed before output.

## Binary identity

`RuntimePlan` and `CommandTrace` use explicit little-endian codecs with four-byte magic values and format version 1. Lengths, tags, references, UTF-8, trailing bytes, and resource limits are checked while decoding. Plan metadata is rebuilt and compared, rather than trusted. JSON is a diagnostic/presentation format and manifest envelope, not the runtime binary ABI. Encoding is canonical for the specified ordered arena; arbitrary semantically equivalent author programs are not normalized to one digest.

The trace binds the SHA-256 digest of the exact runtime-plan bytes and a SHA-256 seed digest. Bundle manifests pin compiler configuration, author component, runtime component, runtime plan, and analysis report.

## Static bounds

Current hard caps are 4,096 nodes, depth 128, 16,384 edges, 256 UTF-8 bytes per string, 1 MiB aggregate author strings, 10,000 expanded events, one 64 MiB WebAssembly memory, 50,000 author hostcalls, and 10,000,000 Wasmtime fuel units. Excess is rejected rather than approximated. Depth and other summaries are computed over backward references without recursively expanding shared DAG branches. Analysis reports structural counts and bounds, not difficulty levels or intent scores.
