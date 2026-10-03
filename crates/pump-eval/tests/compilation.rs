mod common;

use pump_chart::{Fraction, Limits, Node, Plan, WeightedNode};
use pump_eval::{compile, reproduce};

use common::{TestResult, contract, music};

#[test]
fn compilation_accounts_mass_and_reproduces_identically() -> TestResult {
    let plan = Plan {
        music: music(Vec::new())?,
        nodes: vec![
            Node::Tap {
                panel_mask: 1,
                key: "valid".into(),
            },
            Node::Tap {
                panel_mask: 0b1_1111,
                key: "impossible".into(),
            },
            Node::Choice {
                branches: vec![
                    WeightedNode {
                        node: 0,
                        weight: 1,
                        key: "valid".into(),
                    },
                    WeightedNode {
                        node: 1,
                        weight: 1,
                        key: "impossible".into(),
                    },
                ],
                key: "choice".into(),
            },
        ],
        provenance: vec!["valid".into(), "impossible".into(), "choice".into()],
        root: 2,
    };
    let limits = Limits::default();
    let contract = contract();
    let compilation = compile(&plan, &contract, &limits)?;

    assert_eq!(compilation.report.distribution.original_mass, Fraction::ONE);
    assert_eq!(
        compilation.report.distribution.retained_mass,
        Fraction::new(1, 2)?
    );
    assert_eq!(
        compilation.report.distribution.rejected_mass,
        Fraction::new(1, 2)?
    );
    assert_eq!(compilation.runtime.candidates.len(), 1);
    assert!(compilation.report.certificate.exact_within_model);
    let reproduced = reproduce(
        &plan,
        &contract,
        &limits,
        &compilation.runtime,
        &compilation.report,
    )?;
    assert_eq!(reproduced, compilation);
    Ok(())
}

#[test]
fn compilation_merges_duplicate_musical_traces_before_assessment() -> TestResult {
    let plan = Plan {
        music: music(Vec::new())?,
        nodes: vec![
            Node::Tap {
                panel_mask: 1,
                key: "tap".into(),
            },
            Node::Choice {
                branches: vec![
                    WeightedNode {
                        node: 0,
                        weight: 1,
                        key: "first".into(),
                    },
                    WeightedNode {
                        node: 0,
                        weight: 3,
                        key: "second".into(),
                    },
                ],
                key: "choice".into(),
            },
        ],
        provenance: vec!["tap".into(), "choice".into()],
        root: 1,
    };
    let compilation = compile(&plan, &contract(), &Limits::default())?;

    assert_eq!(compilation.report.distribution.unique_candidates, 1);
    assert_eq!(
        compilation.report.candidates[0].original_mass,
        Fraction::ONE
    );
    Ok(())
}

#[test]
fn compilation_aborts_on_evaluator_budget_exhaustion() -> TestResult {
    let plan = Plan {
        music: music(Vec::new())?,
        nodes: vec![
            Node::Tap {
                panel_mask: 1,
                key: "first".into(),
            },
            Node::Rest {
                duration_ticks: 48,
                key: "advance".into(),
            },
            Node::Tap {
                panel_mask: 2,
                key: "second".into(),
            },
            Node::Sequence {
                children: vec![0, 1, 2],
                key: "sequence".into(),
            },
        ],
        provenance: vec![
            "first".into(),
            "advance".into(),
            "second".into(),
            "sequence".into(),
        ],
        root: 3,
    };
    let mut bounded = contract();
    bounded.budgets.max_frames = 1;

    let result = compile(&plan, &bounded, &Limits::default());

    assert!(matches!(
        result,
        Err(pump_eval::CompileError::Evaluation(
            pump_eval::EvalError::FrameBudget { limit: 1 }
        ))
    ));
    Ok(())
}

#[test]
fn all_rejected_error_preserves_exact_mass_and_witnesses() -> TestResult {
    let plan = Plan {
        music: music(Vec::new())?,
        nodes: vec![Node::Tap {
            panel_mask: 0b1_1111,
            key: "impossible".into(),
        }],
        provenance: vec!["impossible".into()],
        root: 0,
    };

    let result = compile(&plan, &contract(), &Limits::default());

    match result {
        Err(pump_eval::CompileError::NoRetainedCandidates(failure)) => {
            assert_eq!(failure.distribution.rejected_mass, Fraction::ONE);
            assert_eq!(failure.candidates.len(), 1);
            assert!(!failure.candidates[0].assessment.rejections.is_empty());
        }
        other => return Err(format!("unexpected result: {other:?}").into()),
    }
    Ok(())
}
