mod common;

use pump_chart::{Fraction, Limits};
use pump_core::{Builder, ScopeKind};

use common::{music, runtime, tap};

fn enumerate(
    conversion: &pump_bridge::Conversion,
) -> Result<pump_chart::Enumeration, pump_chart::EnumerateError> {
    pump_chart::enumerate(&conversion.plan, &Limits::default())
}

#[test]
fn sequence_reuses_the_same_choice_binding() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = tap(&mut builder, 1, 4, "left")?;
    let right = tap(&mut builder, 2, 4, "right")?;
    let choice = builder.choice(&[(1, left), (1, right)], None, "choice", "test")?;
    let root = builder.sequence(&[choice, choice], "root", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(8)?, &Limits::default())?;
    let enumeration = enumerate(&conversion)?;
    let half = Fraction::new(1, 2)?;

    assert_eq!(enumeration.derivations.len(), 2);
    assert!(
        enumeration
            .derivations
            .iter()
            .all(|item| item.prior_mass == half)
    );
    assert!(
        enumeration
            .derivations
            .iter()
            .all(|item| item.chart.notes[0].panel_mask == item.chart.notes[1].panel_mask)
    );
    Ok(())
}

#[test]
fn parallel_and_mirror_share_the_same_choice_binding() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let outer = tap(&mut builder, 1, 4, "outer")?;
    let inner = tap(&mut builder, 2, 4, "inner")?;
    let choice = builder.choice(&[(1, outer), (1, inner)], None, "choice", "test")?;
    let mirrored = builder.mirror(choice, "mirror", "test")?;
    let root = builder.parallel(&[choice, mirrored], "root", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(4)?, &Limits::default())?;
    let enumeration = enumerate(&conversion)?;

    let masks: Vec<u16> = enumeration
        .derivations
        .iter()
        .map(|item| item.chart.notes[0].panel_mask)
        .collect();
    assert_eq!(masks, vec![0x201, 0x102]);
    Ok(())
}

#[test]
fn scopes_make_reused_choices_independent() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = tap(&mut builder, 1, 4, "left")?;
    let right = tap(&mut builder, 2, 4, "right")?;
    let choice = builder.choice(&[(1, left), (1, right)], None, "choice", "test")?;
    let first = builder.scope(ScopeKind::Phrase, "a", choice, "scope-a", "test")?;
    let second = builder.scope(ScopeKind::Phrase, "b", choice, "scope-b", "test")?;
    let root = builder.sequence(&[first, second], "root", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(8)?, &Limits::default())?;

    assert_eq!(conversion.statistics.source_derivations, 4);
    assert_eq!(enumerate(&conversion)?.derivations.len(), 4);
    Ok(())
}

#[test]
fn repeat_indices_make_choice_occurrences_independent() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = tap(&mut builder, 1, 4, "left")?;
    let right = tap(&mut builder, 2, 4, "right")?;
    let choice = builder.choice(&[(1, left), (1, right)], None, "choice", "test")?;
    let root = builder.repeat(choice, 2, "repeat", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(8)?, &Limits::default())?;

    assert_eq!(conversion.statistics.source_derivations, 4);
    Ok(())
}
