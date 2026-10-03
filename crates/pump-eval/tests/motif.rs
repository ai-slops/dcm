mod common;

use pump_chart::Note;
use pump_eval::{CreditPolicy, IntentKind, IntentRule, Requiredness, assess};

use common::{TestResult, contract, music};

fn chart(notes: Vec<Note>) -> pump_chart::Chart {
    pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes,
    }
}

#[test]
fn relational_motif_accepts_mirror_and_rejects_broken_copy() -> TestResult {
    let mut required = contract();
    required.intents = vec![IntentRule {
        id: "mirror-repeat".into(),
        kind: IntentKind::RelationalMotif {
            minimum_notes: 3,
            mirror_equivalent: true,
        },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 3,
        weight: 1,
    }];
    let original = vec![
        Note {
            tick: 0,
            panel_mask: 1 << 0,
            hold_ticks: 0,
        },
        Note {
            tick: 24,
            panel_mask: 1 << 2,
            hold_ticks: 0,
        },
        Note {
            tick: 48,
            panel_mask: 1 << 4,
            hold_ticks: 0,
        },
        Note {
            tick: 96,
            panel_mask: 1 << 9,
            hold_ticks: 0,
        },
        Note {
            tick: 120,
            panel_mask: 1 << 7,
            hold_ticks: 0,
        },
        Note {
            tick: 144,
            panel_mask: 1 << 5,
            hold_ticks: 0,
        },
    ];
    let mut broken = original.clone();
    broken[5].panel_mask = 1 << 6;

    assert!(assess(&chart(original), &music(Vec::new())?, &required)?.accepted);
    assert!(!assess(&chart(broken), &music(Vec::new())?, &required)?.accepted);
    Ok(())
}
