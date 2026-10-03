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
fn reports_alternatives_and_exact_timing_when_bracket_can_be_split() -> TestResult {
    let assessment = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 0b00101,
            hold_ticks: 0,
        }]),
        &music(Vec::new())?,
        &contract(),
    )?;

    assert!(assessment.accepted);
    assert!(assessment.execution.alternative_path_exists);
    assert_eq!(assessment.execution.earliest_infeasible_frame, None);
    assert!(
        assessment.execution.max_objectives.brackets > assessment.execution.min_objectives.brackets
    );
    Ok(())
}

#[test]
fn external_split_demands_match_canonical_grouped_assessment() -> TestResult {
    let split = assess(
        &chart(vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0,
            },
            Note {
                tick: 0,
                panel_mask: 2,
                hold_ticks: 0,
            },
        ]),
        &music(Vec::new())?,
        &contract(),
    )?;
    let grouped = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 3,
            hold_ticks: 0,
        }]),
        &music(Vec::new())?,
        &contract(),
    )?;

    assert_eq!(split, grouped);
    Ok(())
}

#[test]
fn rejects_teleport_when_both_holds_release_at_next_frame() -> TestResult {
    let assessment = assess(
        &chart(vec![
            Note {
                tick: 0,
                panel_mask: (1 << 0) | (1 << 5),
                hold_ticks: 48,
            },
            Note {
                tick: 48,
                panel_mask: (1 << 4) | (1 << 9),
                hold_ticks: 0,
            },
        ]),
        &music(Vec::new())?,
        &contract(),
    )?;

    assert!(!assessment.accepted);
    assert_eq!(assessment.execution.earliest_infeasible_frame, Some(1));
    Ok(())
}

#[test]
fn rejects_contact_demand_outside_finite_two_foot_catalog() -> TestResult {
    let assessment = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 0b1_1111,
            hold_ticks: 0,
        }]),
        &music(Vec::new())?,
        &contract(),
    )?;

    assert!(!assessment.execution.feasible);
    assert_eq!(assessment.execution.earliest_infeasible_frame, Some(0));
    Ok(())
}

#[test]
fn intent_damage_is_explained_by_typed_threshold_rejections() -> TestResult {
    let mut required = contract();
    required.intents = vec![
        IntentRule {
            id: "accent".into(),
            kind: IntentKind::ReferenceAccents { tolerance_ticks: 0 },
            requiredness: Requiredness::Required,
            credit_policy: CreditPolicy::Exclusive,
            threshold: 1,
            weight: 1,
        },
        IntentRule {
            id: "silence".into(),
            kind: IntentKind::NegativeSpace {
                start_tick: 72,
                end_tick: 96,
            },
            requiredness: Requiredness::Required,
            credit_policy: CreditPolicy::Shared,
            threshold: 1,
            weight: 1,
        },
    ];
    let damaged = chart(vec![
        Note {
            tick: 24,
            panel_mask: 1,
            hold_ticks: 0,
        },
        Note {
            tick: 80,
            panel_mask: 2,
            hold_ticks: 0,
        },
    ]);
    let assessment = assess(&damaged, &music(vec![48])?, &required)?;

    assert!(!assessment.accepted);
    assert_eq!(assessment.intents.rejections.len(), 2);
    assert!(
        assessment
            .intents
            .evidence
            .iter()
            .all(|item| item.credited == 0)
    );
    Ok(())
}

#[test]
fn hold_spanning_negative_space_prevents_silence_credit() -> TestResult {
    let mut required = contract();
    required.intents = vec![IntentRule {
        id: "silence".into(),
        kind: IntentKind::NegativeSpace {
            start_tick: 72,
            end_tick: 96,
        },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 1,
        weight: 1,
    }];
    let assessment = assess(
        &chart(vec![Note {
            tick: 48,
            panel_mask: 1,
            hold_ticks: 48,
        }]),
        &music(Vec::new())?,
        &required,
    )?;

    assert!(!assessment.accepted);
    assert_eq!(assessment.intents.evidence[0].score, 0);
    assert_eq!(assessment.intents.rejections.len(), 1);
    Ok(())
}

#[test]
fn rejects_difficulty_outlier_using_all_path_maximum() -> TestResult {
    let mut bounded = contract();
    bounded.difficulty.brackets.maximum = 0;
    let assessment = assess(
        &chart(vec![Note {
            tick: 0,
            panel_mask: 0b00101,
            hold_ticks: 0,
        }]),
        &music(Vec::new())?,
        &bounded,
    )?;

    assert!(!assessment.accepted);
    assert!(
        assessment
            .difficulty
            .rejections
            .iter()
            .any(|item| item.rule_id.as_deref() == Some("brackets"))
    );
    Ok(())
}

#[test]
fn aborts_assessment_when_frame_budget_is_exhausted() -> TestResult {
    let mut bounded = contract();
    bounded.budgets.max_frames = 1;
    let result = assess(
        &chart(vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0,
            },
            Note {
                tick: 48,
                panel_mask: 2,
                hold_ticks: 0,
            },
        ]),
        &music(Vec::new())?,
        &bounded,
    );

    assert!(matches!(
        result,
        Err(pump_eval::EvalError::FrameBudget { limit: 1 })
    ));
    Ok(())
}
