use pump_chart::{
    Fraction, FractionError, Limits, Music, Node, Plan, TempoSegment, WeightedNode, enumerate,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn music(duration_ticks: u64) -> Result<Music, FractionError> {
    Ok(Music {
        duration_ticks,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    })
}

#[test]
fn repeated_choice_occurrences_expand_independently() -> TestResult {
    let plan = Plan {
        music: music(2)?,
        nodes: vec![
            Node::Tap {
                panel_mask: 1,
                key: "left".into(),
            },
            Node::Tap {
                panel_mask: 2,
                key: "right".into(),
            },
            Node::Rest {
                duration_ticks: 1,
                key: "advance".into(),
            },
            Node::Sequence {
                children: vec![0, 2],
                key: "left-step".into(),
            },
            Node::Sequence {
                children: vec![1, 2],
                key: "right-step".into(),
            },
            Node::Choice {
                branches: vec![
                    WeightedNode {
                        node: 3,
                        weight: 1,
                        key: "choose-left".into(),
                    },
                    WeightedNode {
                        node: 4,
                        weight: 1,
                        key: "choose-right".into(),
                    },
                ],
                key: "step".into(),
            },
            Node::Repeat {
                child: 5,
                count: 2,
                key: "twice".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 7],
        root: 6,
    };

    let result = enumerate(&plan, &Limits::default())?;
    let quarter = Fraction::new(1, 4)?;

    assert_eq!(result.derivations.len(), 4);
    assert_eq!(result.total_prior_mass, Fraction::ONE);
    assert!(
        result
            .derivations
            .iter()
            .all(|item| item.prior_mass == quarter)
    );
    assert!(
        result
            .derivations
            .iter()
            .all(|item| item.decisions.len() == 2)
    );
    Ok(())
}

#[test]
fn enumeration_preserves_rest_as_trailing_silence() -> TestResult {
    let plan = Plan {
        music: music(4)?,
        nodes: vec![
            Node::Tap {
                panel_mask: 1,
                key: "tap".into(),
            },
            Node::Rest {
                duration_ticks: 3,
                key: "rest".into(),
            },
            Node::Sequence {
                children: vec![0, 1],
                key: "phrase".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 3],
        root: 2,
    };

    let enumeration = enumerate(&plan, &Limits::default())?;
    let chart = &enumeration.derivations[0].chart;

    assert_eq!(chart.span_ticks, 4);
    assert_eq!(chart.notes.len(), 1);
    Ok(())
}

#[test]
fn enumeration_rejects_forward_arena_references_and_budget_exhaustion() -> TestResult {
    let forward = Plan {
        music: music(1)?,
        nodes: vec![Node::Mirror {
            child: 1,
            key: "bad".into(),
        }],
        provenance: vec!["author:bad".into()],
        root: 0,
    };
    let limits = Limits {
        max_work: 1,
        ..Limits::default()
    };
    let work_heavy = Plan {
        music: music(2)?,
        nodes: vec![
            Node::Rest {
                duration_ticks: 1,
                key: "rest".into(),
            },
            Node::Repeat {
                child: 0,
                count: 2,
                key: "twice".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 2],
        root: 1,
    };

    assert!(enumerate(&forward, &Limits::default()).is_err());
    assert!(enumerate(&work_heavy, &limits).is_err());
    Ok(())
}

#[test]
fn derivation_budget_is_checked_before_cartesian_expansion() -> TestResult {
    let plan = Plan {
        music: music(2)?,
        nodes: vec![
            Node::Rest {
                duration_ticks: 1,
                key: "a".into(),
            },
            Node::Rest {
                duration_ticks: 1,
                key: "b".into(),
            },
            Node::Choice {
                branches: vec![
                    WeightedNode {
                        node: 0,
                        weight: 1,
                        key: "a".into(),
                    },
                    WeightedNode {
                        node: 1,
                        weight: 1,
                        key: "b".into(),
                    },
                ],
                key: "choice".into(),
            },
            Node::Repeat {
                child: 2,
                count: 2,
                key: "twice".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 4],
        root: 3,
    };
    let limits = Limits {
        max_derivations: 3,
        ..Limits::default()
    };

    assert!(enumerate(&plan, &limits).is_err());
    Ok(())
}

#[test]
fn repeat_count_is_rejected_before_materializing_work() -> TestResult {
    let plan = Plan {
        music: music(1)?,
        nodes: vec![
            Node::Rest {
                duration_ticks: 1,
                key: "rest".into(),
            },
            Node::Repeat {
                child: 0,
                count: u32::MAX,
                key: "huge".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 2],
        root: 1,
    };

    assert!(enumerate(&plan, &Limits::default()).is_err());
    Ok(())
}

#[test]
fn mirror_uses_whole_double_layout_reflection() -> TestResult {
    let plan = Plan {
        music: music(1)?,
        nodes: vec![
            Node::Tap {
                panel_mask: 0b11,
                key: "pair".into(),
            },
            Node::Mirror {
                child: 0,
                key: "mirror".into(),
            },
        ],
        provenance: vec!["author:demo".into(); 2],
        root: 1,
    };

    let result = enumerate(&plan, &Limits::default())?;

    assert_eq!(
        result.derivations[0].chart.notes[0].panel_mask,
        (1 << 9) | (1 << 8)
    );
    Ok(())
}
