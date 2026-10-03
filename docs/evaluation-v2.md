# Evaluation and certification v2

`pump-eval` is the deterministic feedback-grade evaluator between finite chart enumeration and the deployed v2 runtime table. It evaluates concrete normalized charts only. Derivation provenance never affects acceptance, so equal musical traces are merged by their note-only candidate ID before evaluation.

## Public boundary

```text
assess(&Chart, &Music, &EvalContract) -> Result<Assessment, EvalError>
compile(&Plan, &EvalContract, &Limits) -> Result<Compilation, CompileError>
reproduce(&Plan, &EvalContract, &Limits, &RuntimeProgram, &CompileReport)
    -> Result<Compilation, VerifyError>
```

`EvalContract` schema 2 binds foot-model version 1, exact travel parameters, an explicitly uncalibrated difficulty envelope, intent rules and credit policy, evaluator budgets, and runtime history bounds. Parsing is followed by structural validation before evaluator-sized allocation: identifiers and labels are at most 256 bytes, rule collections at most 4096 entries, note/frame limits at most 65,536/131,072, request history at most 256 entries, work limits at most 100,000,000, ranges are ordered, and music-bound windows are in range. `Assessment` separates physical execution, difficulty, intent evidence, and typed rejection witnesses. Fatal arithmetic, enumeration, DP-budget, and matching-budget errors return `Err`; they are never reported as an ordinary rejected candidate.

`compile` always enumerates the complete bounded plan first. It then merges duplicate normalized note traces, assesses every unique chart, and removes only charts rejected for physical feasibility, required intent credit, or difficulty bounds. The report contains every unique candidate, its exact original and retained rational mass, its assessment, total original/retained/rejected mass, and all rejection witnesses. Runtime integer weights are constructed by `pump-chart` from retained exact mass.

## Finite two-foot model v1

The catalog has `Off`, one-panel contact, and these conservative same-pad center/corner brackets:

```text
left pad:  DL+C, UL+C, C+UR, C+DR
right pad: DL+C, UL+C, C+UR, C+DR
```

No cross-pad or corner-to-corner bracket exists. A frame assigns every tap and active hold panel to exactly one of two feet. A foot covers at most one catalog pose. Active hold ownership cannot transfer. Hold endpoints are indexed once while events are assembled; candidate transitions never rescan the chart. Releases occur before starts at the same tick, but a foot released at that tick has zero free travel time; this prevents an instantaneous jump at a hold endpoint. Every newly assigned onset resets that foot's travel clock, including a repeated tap at the same pose. Feet without a note-driven transition retain their pose, so idle dancing cannot inflate maximum difficulty.

Panel coordinates are the two five-panel diamonds. Movement is Manhattan distance between doubled pose centers. A transition needs `distance * micros_per_panel_unit`, plus `bracket_setup_micros` when entering a bracket. Available time is integrated exactly over rational tempo segments from the later of the foot's previous transition and previous hold release. Initial placement from `Off` is free.

The DP retains every distinct future-relevant state; it never beam-prunes a route. It records a concrete minimum-total path, whether another route exists, component-wise integer minima and maxima, the exact minimum and maximum composite objectives, and the earliest frame with no state. Component extrema are not added to invent a composite witness. Local-window minima and maxima are propagated independently for every feasible path and every declared note-anchored window.

Counterexamples covered by tests include five simultaneous panels, two distant taps at the exact endpoint of two holds, and a legal center/corner chord that has both one-foot bracket and two-foot alternatives.

## Difficulty and intent

Difficulty is labeled `uncalibrated rule model`; it is not an official PUMP level or an empirical execution probability. Density is onset panels per elapsed second scaled by 1000, using exact rational tempo integration. Hold occupancy is the floor of exact micro-panel time (elapsed microseconds multiplied by held panel count). Local load adds route cost to the window's elapsed-time-normalized onset density, and each window reports its exact rational microsecond duration. Movement, bracket use, and the independently aggregated total objective remain integer rule signals. Minimum constraints are checked against the feasible-path minimum and maximum constraints against the feasible-path maximum. Each declared local-window maximum is checked independently.

Intent scores come from concrete notes plus music-bound reference accents:

- Reference accents and sorted note onsets use maximum one-to-one matching within the declared tick tolerance.
- Negative space succeeds only when its half-open tick interval has neither a tap onset nor overlapping hold occupancy.
- Relational motifs compare equal-duration note sequences and can accept the full ten-panel reversal (`0 <-> 9`, `1 <-> 8`, and so on) used by `pump-chart`.

Evidence lists supporting note indices. Shared credit may reuse evidence. Exclusive rules are solved together by an exact bounded iterative allocation that maximizes satisfied required thresholds before progress and total credit; a note index cannot be reused. The allocator preflights the minimum traversal work and charges every visited search state, so budget exhaustion is a typed error without recursive stack growth. Overlapping accent annotations cannot multiply one note's credit. Required rules reject when allocated weighted credit misses the threshold. Optional credit is reported without affecting acceptance. Reports retain zero-credit evidence and typed threshold failures, so removed accents, filled silence, and broken repetitions are explainable rather than inferred from provenance strings.

## Exact certificate and reproduction

The certificate covers exactly the retained candidate IDs in the deployed digest-sorted runtime table and every declared rule window. Its domain-separated SHA-256 binds the canonical runtime encoding and the full report with an empty self-digest field. Recompilation recomputes both values and requires structural equality with the expected runtime and report.

This proves exhaustive evaluation only within the declared finite model and budgets. It does not certify rejected candidates, subjective artistry, human safety, calibrated difficulty, official rankings, or publisher authenticity. An external bundle signature remains a separate host concern.
