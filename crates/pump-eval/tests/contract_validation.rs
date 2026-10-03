mod common;

use pump_eval::{CreditPolicy, EvalError, IntentKind, IntentRule, Requiredness, assess};

use common::{TestResult, contract, music};

fn empty_chart() -> pump_chart::Chart {
    pump_chart::Chart {
        ticks_per_beat: 48,
        span_ticks: 192,
        notes: Vec::new(),
    }
}

#[test]
fn rejects_zero_note_budget_before_evaluation() -> TestResult {
    let mut invalid = contract();
    invalid.budgets.max_notes = 0;
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));
    Ok(())
}

#[test]
fn rejects_inverted_ranges_and_zero_windows() -> TestResult {
    let mut invalid = contract();
    invalid.difficulty.total.minimum = 2;
    invalid.difficulty.total.maximum = 1;
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));

    let mut invalid = contract();
    invalid.difficulty.label.clear();
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));

    let mut invalid = contract();
    invalid.difficulty.local_windows[0].width_ticks = 193;
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));

    let mut invalid = contract();
    invalid.difficulty.local_windows[0].width_ticks = 0;
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));
    Ok(())
}

#[test]
fn rejects_empty_duplicate_and_out_of_bounds_intent_rules() -> TestResult {
    let rule = IntentRule {
        id: String::new(),
        kind: IntentKind::NegativeSpace {
            start_tick: 12,
            end_tick: 12,
        },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 1,
        weight: 1,
    };
    let mut invalid = contract();
    invalid.intents = vec![rule];
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));

    let duplicate = IntentRule {
        id: "duplicate".into(),
        kind: IntentKind::ReferenceAccents { tolerance_ticks: 0 },
        requiredness: Requiredness::Optional,
        credit_policy: CreditPolicy::Shared,
        threshold: 1,
        weight: 1,
    };
    let mut invalid = contract();
    invalid.intents = vec![duplicate.clone(), duplicate];
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));

    let mut invalid = contract();
    invalid.intents = vec![IntentRule {
        id: "outside".into(),
        kind: IntentKind::NegativeSpace {
            start_tick: 192,
            end_tick: 193,
        },
        requiredness: Requiredness::Required,
        credit_policy: CreditPolicy::Shared,
        threshold: 1,
        weight: 1,
    }];
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &invalid),
        Err(EvalError::InvalidContract(_))
    ));
    Ok(())
}

#[test]
fn request_history_bound_accepts_256_and_rejects_257() -> TestResult {
    let mut bounded = contract();
    bounded.history_policy.recent_window = pump_chart::MAX_REQUEST_HISTORY;
    bounded.history_policy.max_request_history = pump_chart::MAX_REQUEST_HISTORY;
    assert!(assess(&empty_chart(), &music(Vec::new())?, &bounded).is_ok());

    bounded.history_policy.max_request_history = pump_chart::MAX_REQUEST_HISTORY + 1;
    assert!(matches!(
        assess(&empty_chart(), &music(Vec::new())?, &bounded),
        Err(EvalError::InvalidContract(_))
    ));
    Ok(())
}
