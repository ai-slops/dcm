# v1 plan to finite v2 bridge

`pump-bridge` converts a canonical `pump-core::RuntimePlan` into a finite
`pump-chart::Plan`. The adapter version is
`v1-correlated-plan-to-v2-finite@1`.

## Preserved observables

The conversion preserves every reachable v1 tap chart and its exact nominal
prior mass. A v1 tap duration advances later sequence events but is never
converted into a hold. Silence implied by explicit choice duration, sequence
spacing, or the maximum duration of a parallel is represented by v2 rests.
The source root duration must equal `Music.duration_ticks`; the bridge never
pads, stretches, or truncates the song boundary.

Choice variables use the v1 identity `(decision_id, occurrence)`, where
`occurrence` is the exact ordered vector produced by repeat and scope nesting.
Repeat adds `decision_id#index`; scopes add `run:key`, `section:key`, or
`phrase:key`. Sequence, parallel, mirror, and relation add no context. The
first reachable occurrence forks by the declared weights. Later occurrences
with the same identity reuse that binding, including occurrences reached in
different sequence or parallel children. Different repeat iterations and
differently scoped uses remain independent.

Mirror reverses panel `i` to panel `9-i`. Relations retain their validated
left-then-right timing. Parallel children share their start tick. Equivalent
charts are normalized, simultaneous disjoint taps are merged into one mask,
and duplicate charts have their exact rational masses added.

## Finite lowering

The symbolic interpreter carries pending actions, emitted notes, the global
choice environment, and a reduced `Fraction` mass per derivation. It does not
discover outcomes by sampling seeds. Every reachable error, collision, or
arithmetic overflow rejects the conversion instead of silently pruning a
branch.

Normalized charts are passed through `pump_chart::build_runtime`, which merges
duplicates, sorts by the note-only candidate ID, and scales exact rational
masses to canonical integer weights. The resulting v2 plan has one root
`Choice`; each branch is a deterministic sequence of taps and rests. Semantic
keys and provenance include the adapter version, SHA-256 of the canonical v1
runtime bytes, and the candidate ID. Conversion is therefore deterministic
for the same canonical source bytes, music, and limits.

## Bounds and rejection

The supplied v2 `Limits` are validated against hard caps and bound interpreter
depth, active plus finished derivations, notes per derivation, total events,
and cumulative work. Work includes action processing and state/context clone
cost. Repeat count and fork costs are charged before expansion or cloning.
Graph node and edge counts are calculated before lowering, and the completed
plan is validated and encoded with the same limits. All fraction and count
arithmetic is checked through `u128` or checked integer operations.

Canonical v1 encoding performs source validation before expansion. This
rejects forged metadata, invalid relations, duplicate decision IDs, bad
references, and all other v1 structural violations.

## Randomness boundary

The bridge preserves the outcome distribution, not the v1 seed-to-outcome
mapping. A compiled v2 runtime samples the finite candidate choice with the v2
random scheme and history policy. Downstream systems must not expect one seed
to select the same chart in v1 and v2.

The bridge digest identifies the canonical v1 runtime plan. Retaining and
binding the unchanged canonical v1 runtime bytes in package or CAS provenance
is the responsibility of the integrating host.
