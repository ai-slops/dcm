use pump_chart::{
    Chart, Fraction, GeneratedChart, GenerationRequest, HistoryPolicy, Limits, Music, Node, Note,
    Plan, RuntimeProgram, TempoSegment, WeightedChart, build_runtime, decode_plan,
    decode_runtime_program, encode_generated_chart, encode_plan, encode_plan_with_limits,
    encode_runtime_program, encode_runtime_program_with_limits, generate,
};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn music() -> TestResult<Music> {
    Ok(Music {
        duration_ticks: 8,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![
            TempoSegment {
                start_tick: 0,
                micros_per_beat: Fraction::new(500_000, 1)?,
            },
            TempoSegment {
                start_tick: 4,
                micros_per_beat: Fraction::new(400_000, 1)?,
            },
        ],
        audio_sha256: [3; 32],
        reference_accents: vec![0, 4],
    })
}

fn plan() -> TestResult<Plan> {
    Ok(Plan {
        music: music()?,
        nodes: vec![Node::Rest {
            duration_ticks: 8,
            key: "rest".into(),
        }],
        provenance: vec!["test".into()],
        root: 0,
    })
}

fn runtime() -> TestResult<RuntimeProgram> {
    Ok(build_runtime(
        music()?,
        &[WeightedChart {
            chart: Chart {
                ticks_per_beat: 4,
                span_ticks: 8,
                notes: vec![Note {
                    tick: 0,
                    panel_mask: 1,
                    hold_ticks: 0,
                }],
            },
            prior_mass: Fraction::ONE,
        }],
        HistoryPolicy {
            recent_window: 0,
            max_request_history: 0,
        },
    )?)
}

#[test]
fn plan_encoding_honors_exact_codec_byte_boundary() -> TestResult {
    let plan = plan()?;
    let default_bytes = encode_plan(&plan)?;
    let exact_limits = Limits {
        max_codec_bytes: u64::try_from(default_bytes.len())?,
        max_nodes: 2,
        max_total_events: 2,
        ..Limits::default()
    };
    let short_limits = Limits {
        max_codec_bytes: exact_limits.max_codec_bytes - 1,
        ..exact_limits
    };

    let bytes = encode_plan_with_limits(&plan, &exact_limits)?;

    assert_eq!(decode_plan(&bytes, &exact_limits)?, plan);
    assert!(encode_plan_with_limits(&plan, &short_limits).is_err());
    assert!(
        encode_plan_with_limits(
            &plan,
            &Limits {
                max_codec_bytes: 1,
                ..Limits::default()
            }
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn plan_encoding_rejects_tempo_above_node_limit() -> TestResult {
    let plan = plan()?;
    let limits = Limits {
        max_nodes: 1,
        ..Limits::default()
    };

    assert!(encode_plan_with_limits(&plan, &limits).is_err());
    assert!(
        encode_plan_with_limits(
            &plan,
            &Limits {
                max_total_events: 1,
                ..Limits::default()
            }
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn runtime_encoding_honors_decoder_count_and_byte_limits() -> TestResult {
    let runtime = runtime()?;
    let default_bytes = encode_runtime_program(&runtime)?;
    let exact_limits = Limits {
        max_codec_bytes: u64::try_from(default_bytes.len())?,
        ..Limits::default()
    };
    let tempo_limits = Limits {
        max_nodes: 1,
        ..Limits::default()
    };
    let candidate_limits = Limits {
        max_derivations: 0,
        ..Limits::default()
    };
    let note_limits = Limits {
        max_trace_notes: 0,
        ..Limits::default()
    };

    let bytes = encode_runtime_program_with_limits(&runtime, &exact_limits)?;

    assert_eq!(decode_runtime_program(&bytes, &exact_limits)?, runtime);
    assert!(encode_runtime_program_with_limits(&runtime, &tempo_limits).is_err());
    assert!(encode_runtime_program_with_limits(&runtime, &candidate_limits).is_err());
    assert!(encode_runtime_program_with_limits(&runtime, &note_limits).is_err());
    assert!(
        encode_runtime_program_with_limits(
            &runtime,
            &Limits {
                max_codec_bytes: 1,
                ..Limits::default()
            },
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn default_generated_encoding_rejects_decoder_incompatible_chart() -> TestResult {
    let runtime = runtime()?;
    let request = GenerationRequest {
        seed: [7; 32],
        history: Vec::new(),
    };
    let mut generated: GeneratedChart = generate(&runtime, &request)?;
    generated.chart.span_ticks = u64::from(pump_chart::MAX_TRACE_NOTES) + 2;
    generated.chart.notes = (0..=pump_chart::MAX_TRACE_NOTES)
        .map(|tick| Note {
            tick: u64::from(tick),
            panel_mask: 1,
            hold_ticks: 0,
        })
        .collect();

    assert!(encode_generated_chart(&generated).is_err());
    Ok(())
}
