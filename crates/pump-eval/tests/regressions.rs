mod common;

use pump_chart::Note;
use pump_eval::{CreditPolicy, FootPose, IntentKind, IntentRule, Requiredness, assess};

use common::{TestResult, contract, music};

fn chart(notes: Vec<Note>) -> pump_chart::Chart {
    pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes,
    }
}

#[test]
fn final_hold_release_reports_both_feet_off() -> TestResult {
    let assessment = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 48,
        }]),
        &music(Vec::new())?,
        &contract(),
    )?;

    let path = assessment.execution.best_path.ok_or("missing path")?;
    let final_contact = path.contacts.last().ok_or("missing release contact")?;
    assert_eq!(final_contact.tick, 48);
    assert!(matches!(final_contact.poses.left, FootPose::Off));
    assert!(matches!(final_contact.poses.right, FootPose::Off));
    Ok(())
}

#[test]
fn global_exclusive_allocation_prioritizes_required_threshold() -> TestResult {
    let mut configured = contract();
    configured.intents = vec![
        IntentRule {
            id: "optional-first".into(),
            kind: IntentKind::ReferenceAccents { tolerance_ticks: 0 },
            requiredness: Requiredness::Optional,
            credit_policy: CreditPolicy::Exclusive,
            threshold: 1,
            weight: 1,
        },
        IntentRule {
            id: "required-second".into(),
            kind: IntentKind::ReferenceAccents { tolerance_ticks: 0 },
            requiredness: Requiredness::Required,
            credit_policy: CreditPolicy::Exclusive,
            threshold: 1,
            weight: 1,
        },
    ];
    let assessment = assess(
        &chart(vec![Note {
            tick: 48,
            panel_mask: 1,
            hold_ticks: 0,
        }]),
        &music(vec![48])?,
        &configured,
    )?;

    assert!(assessment.accepted);
    assert_eq!(assessment.intents.evidence[0].credited, 0);
    assert_eq!(assessment.intents.evidence[1].credited, 1);
    Ok(())
}

#[test]
fn overlapping_accent_references_do_not_multiply_one_note() -> TestResult {
    let mut configured = contract();
    configured.intents = vec![IntentRule {
        id: "accent".into(),
        kind: IntentKind::ReferenceAccents { tolerance_ticks: 1 },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 1,
        weight: 1,
    }];
    let assessment = assess(
        &chart(vec![Note {
            tick: 48,
            panel_mask: 1,
            hold_ticks: 0,
        }]),
        &music(vec![47, 49])?,
        &configured,
    )?;

    assert_eq!(assessment.intents.evidence[0].score, 1);
    assert_eq!(
        assessment.intents.evidence[0].supporting_note_indices,
        vec![0]
    );
    Ok(())
}

#[test]
fn overlapping_accents_choose_distinct_available_notes() -> TestResult {
    let mut configured = contract();
    configured.intents = vec![IntentRule {
        id: "accent".into(),
        kind: IntentKind::ReferenceAccents { tolerance_ticks: 1 },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 2,
        weight: 1,
    }];
    let assessment = assess(
        &chart(vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0,
            },
            Note {
                tick: 1,
                panel_mask: 2,
                hold_ticks: 0,
            },
        ]),
        &music(vec![0, 1])?,
        &configured,
    )?;

    assert!(assessment.accepted);
    assert_eq!(assessment.intents.evidence[0].score, 2);
    assert_eq!(
        assessment.intents.evidence[0].supporting_note_indices,
        vec![0, 1]
    );
    Ok(())
}
