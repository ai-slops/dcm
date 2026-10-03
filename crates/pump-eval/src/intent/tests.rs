use pump_chart::HistoryPolicy;

use super::{Detection, allocate};
use crate::{
    CreditPolicy, DifficultyEnvelope, EvalBudgets, EvalContract, EvalError, FootModel, IntentKind,
    IntentRule, MetricRange, Requiredness,
};

fn contract(max_matching_work: u64) -> EvalContract {
    let range = MetricRange {
        minimum: 0,
        maximum: u64::MAX,
    };
    EvalContract {
        schema_version: 2,
        foot_model: FootModel {
            version: 1,
            micros_per_panel_unit: 1,
            bracket_setup_micros: 1,
            crossover_penalty: 0,
            bracket_penalty: 0,
        },
        difficulty: DifficultyEnvelope {
            label: "allocation-test".into(),
            density: range,
            movement: range,
            brackets: range,
            hold_occupancy: range,
            local_load: range,
            total: range,
            local_windows: Vec::new(),
        },
        intents: vec![IntentRule {
            id: "large-exclusive".into(),
            kind: IntentKind::RelationalMotif {
                minimum_notes: 2,
                mirror_equivalent: false,
            },
            requiredness: Requiredness::Required,
            credit_policy: CreditPolicy::Exclusive,
            threshold: 1,
            weight: 1,
        }],
        budgets: EvalBudgets {
            max_notes: 65_536,
            max_frames: 1,
            max_dp_work: 1,
            max_matching_work,
        },
        history_policy: HistoryPolicy {
            recent_window: 0,
            max_request_history: 0,
        },
    }
}

#[test]
fn large_exclusive_input_returns_budget_error_without_recursive_descent() {
    let unit_count = 32_768_u32;
    let detection = Detection {
        units: (0..unit_count).map(|note| vec![note]).collect(),
        explanation: "large exclusive allocation fixture",
    };
    let configured = contract(u64::from(unit_count));
    let mut work = 0;

    let result = allocate(&configured, &[detection], &mut work);

    assert_eq!(
        result,
        Err(EvalError::MatchingBudget {
            limit: u64::from(unit_count)
        })
    );
    assert_eq!(work, 0);
}
