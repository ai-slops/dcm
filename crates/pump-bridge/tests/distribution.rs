mod common;

use pump_chart::{Fraction, Limits, Node};
use pump_core::Builder;

use common::{music, runtime, tap};

fn enumerate(
    conversion: &pump_bridge::Conversion,
) -> Result<pump_chart::Enumeration, pump_chart::EnumerateError> {
    pump_chart::enumerate(&conversion.plan, &Limits::default())
}

#[test]
fn choice_padding_preserves_explicit_source_duration() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let short = tap(&mut builder, 1, 2, "short")?;
    let long = tap(&mut builder, 2, 6, "long")?;
    let root = builder.choice(&[(1, short), (1, long)], Some(8), "choice", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(8)?, &Limits::default())?;
    let enumeration = enumerate(&conversion)?;

    assert!(
        enumeration
            .derivations
            .iter()
            .all(|item| item.chart.span_ticks == 8)
    );
    assert!(
        enumeration
            .derivations
            .iter()
            .all(|item| item.chart.notes[0].hold_ticks == 0)
    );
    assert!(conversion.plan.nodes.iter().any(|node| matches!(
        node,
        Node::Rest {
            duration_ticks: 8,
            ..
        }
    )));
    Ok(())
}

#[test]
fn exact_products_and_duplicate_charts_are_merged() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let same_a = tap(&mut builder, 1, 4, "same-a")?;
    let same_b = tap(&mut builder, 1, 4, "same-b")?;
    let other = tap(&mut builder, 2, 4, "other")?;
    let inner = builder.choice(&[(1, same_b), (2, other)], None, "inner", "test")?;
    let root = builder.choice(&[(1, same_a), (3, inner)], None, "outer", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(4)?, &Limits::default())?;
    let enumeration = enumerate(&conversion)?;
    let masses: Vec<Fraction> = enumeration
        .derivations
        .iter()
        .map(|item| item.prior_mass)
        .collect();

    assert_eq!(conversion.statistics.source_derivations, 3);
    assert_eq!(conversion.statistics.unique_charts, 2);
    assert_eq!(masses, vec![Fraction::new(1, 2)?, Fraction::new(1, 2)?]);
    assert_eq!(conversion.statistics.total_prior_mass, Fraction::ONE);
    Ok(())
}

#[test]
fn conditional_choice_is_forked_only_when_reached() -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = Builder::new(pump_core::Limits::default());
    let a = tap(&mut builder, 1, 4, "a")?;
    let b = tap(&mut builder, 2, 4, "b")?;
    let conditional = builder.choice(&[(1, a), (1, b)], None, "conditional", "test")?;
    let root = builder.choice(&[(1, a), (1, conditional)], None, "root", "test")?;
    let conversion =
        pump_bridge::convert(&runtime(builder, root)?, &music(4)?, &Limits::default())?;

    assert_eq!(conversion.statistics.source_derivations, 3);
    assert_eq!(conversion.statistics.unique_charts, 2);
    Ok(())
}

#[test]
fn sampled_v1_outputs_belong_to_the_exact_candidate_set() -> Result<(), Box<dyn std::error::Error>>
{
    let mut builder = Builder::new(pump_core::Limits::default());
    let left = tap(&mut builder, 1, 4, "left")?;
    let right = tap(&mut builder, 2, 4, "right")?;
    let root = builder.choice(&[(1, left), (3, right)], None, "choice", "test")?;
    let source = runtime(builder, root)?;
    let target_music = music(4)?;
    let conversion = pump_bridge::convert(&source, &target_music, &Limits::default())?;
    let candidate_ids: std::collections::BTreeSet<_> = enumerate(&conversion)?
        .derivations
        .iter()
        .map(|item| pump_chart::candidate_id(&item.chart))
        .collect::<Result<_, _>>()?;

    for byte in 0..64_u8 {
        let trace = pump_core::generate(&source, &[byte; 32])?;
        let chart = pump_chart::Chart {
            ticks_per_beat: target_music.ticks_per_beat,
            span_ticks: target_music.duration_ticks,
            notes: trace
                .commands
                .iter()
                .map(|command| pump_chart::Note {
                    tick: u64::from(command.tick),
                    panel_mask: command.panel_mask,
                    hold_ticks: 0,
                })
                .collect(),
        };
        let id = pump_chart::candidate_id(&chart)?;
        assert!(candidate_ids.contains(&id));
    }
    Ok(())
}
