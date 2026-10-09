# Reusable packages in the feedback pipeline

The package bridge connects existing v1 song/pattern/style components to the v2 evaluator,
history-aware runtime, and signed certificate workflow. It reuses the original package resolver,
CAS loader, Wasmtime registry, shared builder session, and provenance recorder. No guest is
permitted to return an opaque serialized Plan or concrete chart.

## Source and stored workflows

```sh
demo="$(mktemp -d)"
node scripts/make-feedback-audio.mjs "$demo/excerpt.wav"
./dist/pump package resolve dist/song-a.package.json --out "$demo/song.lock.json"
./dist/pump package cache dist/song-a.package.json --lock "$demo/song.lock.json" --store "$demo/store"

./dist/pump chart compile-package dist/song-a.package.json \
  --lock "$demo/song.lock.json" --runtime dist/chart-runtime.component.wasm \
  --music dist/package-feedback/song-a.music.json --audio "$demo/excerpt.wav" \
  --contract dist/package-feedback/contract.json --out "$demo/source.bundle"

./dist/pump chart compile-locked "$demo/song.lock.json" --store "$demo/store" \
  --runtime dist/chart-runtime.component.wasm \
  --music dist/package-feedback/song-a.music.json \
  --contract dist/package-feedback/contract.json --out "$demo/stored.bundle"

./dist/pump chart analyze "$demo/stored.bundle" --format json
./dist/pump chart verify "$demo/stored.bundle" --format json
```

`package compile-locked` still emits a v1 bundle. `chart compile-locked` emits an evaluated v2
bundle from the same locked source components. Both paths preserve the supplied lock bytes.
After caching, the chart command does not need the original manifest or component paths.
The runtime component, music, and evaluation contract remain explicit inputs. Completed bridge
bundles need neither the original source files nor the CAS for generation and verification.

The shipped music files describe short excerpts: source spans are 5 ticks for song A, 7 for song B,
and 10 for the correlated-repeat example. The music span must match exactly; the bridge never
silently stretches or pads a package to match unrelated music metadata. The example foot-model
parameters are demonstration values, not calibrated human limits.

## Preserved and changed semantics

- v1 tap durations remain spacing and become explicit v2 rests, never holds.
- Explicit choice padding, sequence timing, parallel maximum spans, scopes, repeats, mirrors,
  and validated relation semantics are preserved.
- Reusing a v1 choice in the same occurrence context reuses its selection. The bridge enumerates
  those correlated assignments rather than replacing them with independent v2 choices.
- Canonically equal musical charts merge their exact rational prior mass. Ordinary v2 evaluation
  may subsequently reject candidates and report the removed mass.
- Seed mapping changes to v2. The bridge preserves the declared outcome distribution, not the
  result associated with a particular v1 seed. Existing v1 bundles continue to replay unchanged.

The `song-correlated` example chooses a sweep or accent with weights 5:1, then reuses that same
choice twice. It has exactly two outcomes with masses 5/6 and 1/6, not four independently combined
outcomes. Its second phrase must equal the first after a five-tick shift.

See [bridge semantics](bridge-semantics.md) for the bounded symbolic interpreter and lowering rules.
Large conversions fail explicitly at work, derivation, graph, arithmetic, or codec limits; outcomes
are never sampled to discover the space or silently dropped during conversion.

## Bundle provenance and trust

An optional `package_bridge` field in the schema-2 manifest pins the adapter, source codec,
seed-mapping boundary, and package-host policy. Its presence also requires four digest-pinned files:

| File | Purpose |
| --- | --- |
| `package.lock.json` | Exact component identities and dependency contracts |
| `package-invocations.json` | Host-recorded package calls and style policies |
| `source-plan-v1.bin` | Canonical validated v1 Plan snapshot in the existing `PRTP@1` codec |
| `bridge-report.json` | Source/converted digests and reproducible enumeration statistics |

Loading a bridge bundle checks those links and reproduces the conversion from the stored v1 Plan.
`chart verify` additionally reproduces all v2 assessments, pruning, weights, and certificate data.
The runtime WASM still consumes only the v2 runtime table; the developer CLI performs the extra
provenance checks. Ordinary v2 bundles omit the extension and remain unchanged.

Signing covers the complete manifest, including extension presence and all source-evidence hashes.
Removing the extension invalidates an existing trusted signature. Hashes and reproducible conversion
do not authenticate the original artist: package invocation records remain trusted-build-host
attestations. Verification does not rerun the original authoring components; publisher trust still
requires an externally supplied trusted key, as documented in [chart v2](chart-v2.md).
