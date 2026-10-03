use pump_chart::{
    Chart, Fraction, FractionError, GenerationRequest, HistoryPolicy, Limits, Music, Node, Note,
    Plan, TempoSegment, WeightedChart, build_runtime, decode_generation_request, decode_plan,
    encode_generation_request, encode_plan,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn music() -> Result<Music, FractionError> {
    Ok(Music {
        duration_ticks: 4,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [3; 32],
        reference_accents: vec![0],
    })
}

#[test]
fn plan_codec_round_trips_and_checks_arena_references() -> TestResult {
    let plan = Plan {
        music: music()?,
        nodes: vec![Node::Hold {
            panel_mask: 1,
            duration_ticks: 4,
            key: "hold".into(),
        }],
        provenance: vec!["author:hold".into()],
        root: 0,
    };
    let bytes = encode_plan(&plan)?;

    assert_eq!(decode_plan(&bytes, &Limits::default())?, plan);
    let invalid = Plan {
        music: music()?,
        nodes: vec![Node::Mirror {
            child: 1,
            key: "forward".into(),
        }],
        provenance: vec!["author:bad".into()],
        root: 0,
    };
    assert!(encode_plan(&invalid).is_err());
    Ok(())
}

#[test]
fn plan_requires_unique_nonempty_node_semantic_keys() -> TestResult {
    let duplicate = Plan {
        music: music()?,
        nodes: vec![
            Node::Rest {
                duration_ticks: 1,
                key: "same".into(),
            },
            Node::Rest {
                duration_ticks: 1,
                key: "same".into(),
            },
        ],
        provenance: vec!["author:a".into(), "author:b".into()],
        root: 1,
    };
    let empty = Plan {
        music: music()?,
        nodes: vec![Node::Rest {
            duration_ticks: 1,
            key: String::new(),
        }],
        provenance: vec!["author:a".into()],
        root: 0,
    };

    assert!(encode_plan(&duplicate).is_err());
    assert!(encode_plan(&empty).is_err());
    Ok(())
}

#[test]
fn decoding_rejects_forged_counts_and_oversized_limit_profiles() -> TestResult {
    let request = GenerationRequest {
        seed: [0; 32],
        history: Vec::new(),
    };
    let mut bytes = encode_generation_request(&request)?;
    bytes[38..42].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(decode_generation_request(&bytes, &Limits::default()).is_err());

    let valid = encode_generation_request(&request)?;
    let limits = Limits {
        max_total_events: u64::MAX,
        ..Limits::default()
    };
    assert!(decode_generation_request(&valid, &limits).is_err());
    Ok(())
}

#[test]
fn history_has_a_fixed_ceiling_independent_of_caller_profiles() -> TestResult {
    let history_len = usize::try_from(pump_chart::MAX_REQUEST_HISTORY)? + 1;
    let request = GenerationRequest {
        seed: [0; 32],
        history: vec![pump_chart::CandidateId([0; 32]); history_len],
    };
    assert!(encode_generation_request(&request).is_err());

    let policy = HistoryPolicy {
        recent_window: 0,
        max_request_history: pump_chart::MAX_REQUEST_HISTORY + 1,
    };
    let weighted = WeightedChart {
        chart: Chart {
            ticks_per_beat: 4,
            span_ticks: 4,
            notes: vec![Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0,
            }],
        },
        prior_mass: Fraction::ONE,
    };
    assert!(build_runtime(music()?, &[weighted], policy).is_err());
    Ok(())
}
