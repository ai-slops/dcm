use std::collections::BTreeSet;

use pump_core::{Builder, Limits, ScopeKind, compile, generate, sample_weighted};

#[test]
fn prf_matches_literal_golden_vectors() {
    // Given / When
    let empty = sample_weighted(&[0; 32], "choice", &[], &[1, 3, 2]).expect("sample");
    let nested =
        sample_weighted(&[7; 32], "choice.kick", &["run", "phrase:a"], &[1, 3, 2]).expect("sample");
    let ascending_seed: [u8; 32] = core::array::from_fn(|index| u8::try_from(index).expect("byte"));
    let wide = sample_weighted(
        &ascending_seed,
        "edge",
        &["run:r", "section:s"],
        &[u32::MAX, u32::MAX - 1],
    )
    .expect("sample");

    // Then
    assert_eq!((empty, nested, wide), (2, 0, 1));
}

#[test]
fn moving_choice_node_does_not_change_selected_command() {
    // Given
    let baseline = positioned_choice(false).expect("baseline plan");
    let shifted = positioned_choice(true).expect("shifted plan");

    // When
    let first = generate(&baseline, &[9; 32]).expect("baseline");
    let second = generate(&shifted, &[9; 32]).expect("shifted");

    // Then
    assert_eq!(first.commands, second.commands);
}

#[test]
fn mirror_uses_standard_ten_panel_reversal() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let tap = builder.tap(0b0000000101, 2, "tap", "source").expect("tap");
    let mirror = builder.mirror(tap, "mirror", "source").expect("mirror");
    let runtime = compile(&builder.finish(mirror).expect("plan")).expect("compile");

    // When
    let trace = generate(&runtime, &[0; 32]).expect("generate");

    // Then
    assert_eq!(trace.commands[0].panel_mask, 0b1010000000);
    assert_eq!(trace.commands[0].duration, 2);
}

#[test]
fn repeat_occurrences_can_select_distinct_musical_outcomes() {
    // Given
    let runtime = repeated_choice().expect("repeated plan");

    // When
    let trace = (0_u8..=255)
        .map(|seed| generate(&runtime, &[seed; 32]).expect("generate"))
        .find(|trace| {
            trace
                .commands
                .iter()
                .map(|command| command.panel_mask)
                .collect::<BTreeSet<_>>()
                .len()
                > 1
        })
        .expect("a seed with distinct repeat outcomes");

    // Then
    assert_eq!(
        trace
            .commands
            .iter()
            .map(|command| command.tick)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn same_choice_site_at_same_occurrence_is_intentionally_correlated() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let left = builder.tap(1, 1, "left", "source").expect("left");
    let right = builder.tap(2, 1, "right", "source").expect("right");
    let choice = builder
        .choice(&[(1, left), (1, right)], None, "choice", "source")
        .expect("choice");
    let sequence = builder
        .sequence(&[choice, choice], "sequence", "source")
        .expect("sequence");
    let runtime = compile(&builder.finish(sequence).expect("plan")).expect("compile");

    // When
    let trace = generate(&runtime, &[17; 32]).expect("generate");

    // Then
    assert_eq!(trace.commands[0].panel_mask, trace.commands[1].panel_mask);
}

#[test]
fn nested_mirrors_cancel() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let tap = builder.tap(1, 1, "tap", "source").expect("tap");
    let first = builder
        .mirror(tap, "mirror.first", "source")
        .expect("mirror");
    let second = builder
        .mirror(first, "mirror.second", "source")
        .expect("mirror");
    let runtime = compile(&builder.finish(second).expect("plan")).expect("compile");

    // When
    let trace = generate(&runtime, &[0; 32]).expect("generate");

    // Then
    assert_eq!(trace.commands[0].panel_mask, 1);
}

#[test]
fn seed_corpus_varies_command_masks_not_only_digest_metadata() {
    // Given
    let runtime = positioned_choice(false).expect("choice plan");

    // When
    let masks: BTreeSet<u16> = (0_u8..=255)
        .map(|seed| generate(&runtime, &[seed; 32]).expect("generate").commands[0].panel_mask)
        .collect();

    // Then
    assert_eq!(masks, BTreeSet::from([1, 2]));
}

fn positioned_choice(shifted: bool) -> Result<pump_core::RuntimePlan, pump_core::PlanError> {
    let mut builder = Builder::new(Limits::default());
    if shifted {
        builder.tap(4, 1, "unreachable", "source")?;
    }
    let left = builder.tap(1, 1, "left", "source")?;
    let right = builder.tap(2, 1, "right", "source")?;
    let choice = builder.choice(&[(1, left), (1, right)], None, "choice", "source")?;
    compile(&builder.finish(choice)?)
}

fn repeated_choice() -> Result<pump_core::RuntimePlan, pump_core::PlanError> {
    let mut builder = Builder::new(Limits::default());
    let left = builder.tap(1, 1, "left", "source")?;
    let right = builder.tap(2, 1, "right", "source")?;
    let choice = builder.choice(&[(1, left), (1, right)], None, "choice", "source")?;
    let scoped = builder.scope(ScopeKind::Phrase, "phrase", choice, "scope", "source")?;
    let repeat = builder.repeat(scoped, 3, "repeat", "source")?;
    compile(&builder.finish(repeat)?)
}
