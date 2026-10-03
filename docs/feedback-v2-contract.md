# Feedback-grade v2 implementation contract

This is the engineering contract for the additive feedback-grade pipeline. Existing v1 structs, codecs, WIT worlds, bundles, PRF vectors, and package flows remain unchanged. A v2 bundle is explicitly selected through `pump chart ...`, not guessed from failed v1 decoding.

## Required outcomes

1. Hold intervals, rests, same-tick release-before-press semantics, and strict logical validity.
2. A versioned two-foot contact model with hold ownership, explicitly allowed brackets, movement-time constraints, alternatives, and witness paths.
3. Exact beat/tick conversion, tempo changes, signed audio offset, and audio-resource digest binding.
4. Evidence derived from concrete notes and reference anchors; required/optional IntentPoints with credit policies, scores, and damage examples.
5. Versioned rule-based difficulty signals, local windows, full deployed-candidate checks, and counterexample reports.
6. Exact prior/retained distribution accounting, deterministic recent-history exclusion with documented fallback, reproducible certification, and optional externally trusted release signatures.

No official PUMP rating, universal human safety, or empirical execution probability is claimed. The finite model and its limits are explicit inputs covered by certification.

## Ownership and dependencies

- `crates/pump-chart`: independent v2 model, canonical binary codecs, exact timing, finite enumeration, normalized candidates, history-aware deterministic runtime selection.
- `crates/pump-eval`: depends on `pump-chart`; foot projection, difficulty, evidence, intents, compile/prune/report/certification reproduction.
- `crates/pump-cli/src/chart_*`: v2 WIT host, bundle files, compile/generate/analyze/explain/verify/test-seeds/sign/keygen, signatures, user-facing diagnostics.
- `components/chart-author`, `components/chart-runtime`, `wit/chart/`: v2 authoring and runtime demonstration, with no WASI imports and no guest-supplied serialized Plan.
- Root manifests and Docker/test orchestration: lead-owned. Each worker owns its subtree and coordinates public API changes before editing another worker's assumptions.

## Core API handshake

The core worker publishes concrete Rust definitions and notifies evaluation and host workers before they depend on them. The following conceptual interfaces and names are fixed unless all affected owners agree on a correction:

```text
Plan = music + bounded node arena + root
Chart = ticks_per_beat + span_ticks + canonical notes
Note = tick + panel_mask + hold_ticks (zero means tap)
Music = duration_ticks + ticks_per_beat + signed offset + rational tempo segments
        + audio digest + reference accent ticks
Fraction = reduced checked u128 numerator/denominator
Derivation = Chart + exact prior mass + decisions/provenance
RuntimeProgram = Music + digest-sorted Candidate table + history policy
Candidate = note-only ID + Chart + positive integer weight + original prior mass
GenerationRequest = seed + bounded ordered recent candidate IDs
GeneratedChart = selected Chart/ID + program/request digests + selection ratios
                 + explicit history-fallback flag

enumerate(&Plan, &Limits) -> Enumeration
build_runtime(music, weighted charts, history policy) -> RuntimeProgram
generate(&RuntimeProgram, &GenerationRequest) -> GeneratedChart
encode/decode Plan, RuntimeProgram, GenerationRequest, GeneratedChart
validate_chart, frames, exact song_time and elapsed_time helpers
```

Plan operators: Tap, Hold, Rest, Sequence, Parallel, bounded Repeat, weighted Choice, Mirror. Every dynamic choice occurrence is independent. Correlation is expressed structurally: repeating a choice differs from choosing a repeated branch. Semantic keys label diagnostics and provenance rather than implicitly sharing random variables.

Tap has zero span. Hold advances by its positive duration. Rest advances without emitting notes. Sequence sums spans; Parallel takes the maximum. Music declares the fixed whole-chart duration, and every derivation must fit within it. Trailing silence is preserved in chart identity. A tap at the chart-end boundary is invalid; a hold may end there.

Holds are half-open intervals. At a tick, releases happen before taps/new hold starts. Overlapping demands on the same panel, invalid masks, duplicate taps, zero holds, unsupported timing, and exceeded bounds fail explicitly. Intermediate node references point backward. Limits cover nodes, depth, edges, derivation count, individual trace size, total enumeration work, strings, and bytes.

Tempo segments begin at zero and are strictly ordered. A positive reduced rational microseconds-per-beat represents tempo without floating-point ambiguity. `song_time(0) = offset_micros`. Integration is exact; a presentation timestamp may round only at the final conversion. Arithmetic overflow fails rather than approximates.

## Evaluation API handshake

The evaluation worker publishes typed `EvalContract`, `Assessment`, `CompileReport`, and `Compilation` records, with serde JSON only for configuration and diagnostics. Expected entry points:

```text
assess(&Chart, &Music, &EvalContract) -> Assessment
compile(&Plan, &EvalContract, &Limits) -> Compilation { runtime, report }
verify/reproduce bundled Plan + contract + limits -> identical runtime/report
```

Evaluation is a deterministic pure function of concrete chart, music annotations, and contract. It must not depend on derivation provenance, so duplicate concrete charts can be merged safely. Budget/overflow/internal failures abort compilation; they are never treated as ordinary rejected candidates.

The foot model covers canonical note-driven projections rather than gratuitous dance motion. Feet retain idle poses, and free elapsed time accumulates to their next note-driven transition. Active hold ownership cannot jump between feet. Ending a hold at the next frame does not grant instantaneous travel to a distant panel. A finite versioned contact catalog defines Off, single-panel, and explicitly allowed same-pad bracket poses. Report a concrete minimum-cost path, alternative existence, min/max metrics, and the first unreachable frame when infeasible.

Difficulty is an explicit rule model, not an official rating. Report integer density, movement, bracket, hold occupancy, recovery/local-window and total signals where implemented. Every configured minimum/maximum condition is checked over feasible projections and every retained candidate. Composite objectives need their own valid aggregation, not the sum of unrelated extrema witnesses.

Intent detectors include reference-accent hits, negative-space windows, and repeated relational motifs. Evidence records supporting note indices. Required thresholds and exclusive/shared credit must affect acceptance. Damage tests remove accents, break repetitions, and fill intended silence; mirror-preserving patterns retain their intended relational score.

## Distribution and runtime

Enumeration computes exact rational derivation probabilities before pruning. Duplicate note traces combine their mass. All invalid/pruned candidates have diagnostics; retained and removed prior mass are reported exactly. Surviving runtime weights are proportional to retained prior mass, checked and reduced with no floating-point decisions.

Candidate identity depends only on canonical musical notes, grid, and chart span, not seed/history/provenance. Runtime candidate order is by digest. Request identity includes seed and ordered history. History excludes the configured recent window; if all candidates are excluded, the runtime samples the complete base distribution and reports an explicit allow-repeat fallback. It never changes or redraws the caller's seed.

The runtime component is import-free and executes only a precompiled candidate table. It emits the complete chart before play. Its PRF has a v2 domain separator; v1 random behavior remains byte-identical.

## Bundle and verification

The v2 bundle contains canonical author Plan bytes, compile limits, evaluation contract, runtime table, exact runtime component, analysis/certification report, and a digest-pinning schema-2 manifest. Verification hashes all files, strictly decodes them, re-enumerates and re-evaluates the Plan, and compares the reproduced runtime/report. Merely trusting claimed min/max witnesses is insufficient.

An exact-within-model certificate covers every deployed candidate and declared rule window. It does not certify rejected candidates, subjective artistry, calibrated player probabilities, or official ranked play. Signing uses Ed25519 over a domain-separated exact manifest message; authenticity is only true against a caller-supplied trusted public key. A public key carried beside a signature is not its own trust anchor.

## Acceptance surfaces

- Real Rust v2 Author Component builds a host-owned Plan with holds, rests, repetition and alternative charts.
- CLI compiles it with music and evaluation contracts, emitting useful rejection witnesses and retained-distribution reports.
- Import-free v2 runtime generates reproducible charts with and without history; exhaustion exercises documented fallback.
- Same audio offset/tempo map produces exact expected song times at changes and hold endpoints.
- Impossible contacts, insufficient hold ownership, impossible travel, damaged required intents, and difficulty outliers are rejected under the declared model.
- Verification replays all finite candidates; modified reports/plans/contracts and untrusted signatures fail their respective checks.
- Existing v1 package/store/gateway tests still pass. No `.dim` modifications are made.
