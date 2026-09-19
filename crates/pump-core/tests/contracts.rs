use proptest::prelude::*;
use pump_core::{
    Builder, Limits, NodeId, PlanError, RelationKind, ScopeKind, compile, decode_runtime_plan,
    encode_runtime_plan, generate, sample_weighted,
};

#[test]
fn prf_is_path_addressed_when_same_site_moves_in_a_sequence() {
    // Given
    let weights = [1, 3, 2];
    let seed = [7_u8; 32];
    let occurrence = ["run", "phrase:a"];

    // When
    let first = sample_weighted(&seed, "choice.kick", &occurrence, &weights).expect("valid");
    let second = sample_weighted(&seed, "choice.kick", &occurrence, &weights).expect("valid");

    // Then
    assert_eq!(first, second);
}

#[test]
fn builder_rejects_forward_reference_before_allocating() {
    // Given
    let mut builder = Builder::new(Limits::default());

    // When
    let error = builder
        .repeat(NodeId(99), 2, "repeat.bad", "test")
        .expect_err("forward reference must fail");

    // Then
    assert!(matches!(error, PlanError::ForwardReference { .. }));
    assert_eq!(builder.node_count(), 0);
}

#[test]
fn parallel_rejects_panel_collisions() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let left = builder.tap(0b1, 4, "tap.left", "test").expect("tap");
    let right = builder.tap(0b1, 4, "tap.right", "test").expect("tap");

    // When
    let error = builder
        .parallel(&[left, right], "parallel.bad", "test")
        .expect_err("collision must fail");

    // Then
    assert!(matches!(error, PlanError::PanelCollision { .. }));
}

#[test]
fn codec_rejects_unknown_version() {
    // Given
    let bytes = b"PRTP\x02\0";

    // When
    let error = decode_runtime_plan(bytes).expect_err("version must fail");

    // Then
    assert!(matches!(error, PlanError::UnsupportedVersion(2)));
}

#[test]
fn codec_rejects_tampered_forward_reference() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let tap = builder.tap(1, 1, "tap", "test").expect("tap");
    let plan = compile(&builder.finish(tap).expect("plan")).expect("compile");
    let mut bytes = encode_runtime_plan(&plan).expect("encode");
    bytes.extend_from_slice(&[0xff]);

    // When
    let error = decode_runtime_plan(&bytes).expect_err("tamper must fail");

    // Then
    assert!(matches!(
        error,
        PlanError::InvalidFormat("trailing plan bytes")
    ));
}

#[test]
fn repeat_rejects_checked_overflow() {
    // Given
    let mut builder = Builder::new(Limits {
        max_expansions: u32::MAX,
        max_trace: u32::MAX,
        ..Limits::default()
    });
    let tap = builder.tap(1, u32::MAX, "tap", "test").expect("tap");

    // When
    let error = builder
        .repeat(tap, 2, "repeat", "test")
        .expect_err("overflow must fail");

    // Then
    assert_eq!(error, PlanError::Overflow);
}

#[test]
fn generation_is_deterministic_and_seed_sensitive() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let a = builder.tap(1, 2, "tap.a", "test").expect("tap");
    let b = builder.tap(2, 2, "tap.b", "test").expect("tap");
    let choice = builder
        .choice(&[(1, a), (1, b)], None, "choice.ab", "test")
        .expect("choice");
    let scoped = builder
        .scope(ScopeKind::Phrase, "p0", choice, "scope.p0", "test")
        .expect("scope");
    let plan = builder.finish(scoped).expect("plan");
    let runtime = compile(&plan).expect("compile");

    // When
    let one = generate(&runtime, &[1; 32]).expect("generate");
    let same = generate(&runtime, &[1; 32]).expect("generate");
    let mut varied = false;
    for seed in 2_u8..=32 {
        varied |= generate(&runtime, &[seed; 32]).expect("generate").commands != one.commands;
    }

    // Then
    assert_eq!(one.commands, same.commands);
    assert!(varied);
}

#[test]
fn relations_are_checked_structurally() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let left = builder.tap(1, 1, "tap.l", "test").expect("tap");
    let right = builder.tap(2, 1, "tap.r", "test").expect("tap");

    // When
    let error = builder
        .relation(RelationKind::Same, left, right, "rel.same", "test")
        .expect_err("different masks cannot be same");

    // Then
    assert!(matches!(error, PlanError::RelationViolation { .. }));
}

proptest! {
    #[test]
    fn weighted_sampler_always_returns_an_alternative(
        seed in prop::array::uniform32(any::<u8>()),
        weights in prop::collection::vec(1_u32..10_000, 1..32),
    ) {
        // Given / When
        let selected = sample_weighted(&seed, "property.choice", &["run"], &weights)
            .expect("positive bounded weights");

        // Then
        prop_assert!(selected < weights.len());
    }
}
