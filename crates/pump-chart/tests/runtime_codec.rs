use pump_chart::{
    Chart, Fraction, FractionError, GeneratedChart, GenerationRequest, HistoryPolicy, Limits,
    Music, Note, RuntimeError, RuntimeProgram, TempoSegment, WeightedChart, build_runtime,
    decode_generated_chart, decode_generation_request, decode_runtime_program,
    encode_generated_chart, encode_generation_request, encode_runtime_program, generate,
};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

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

fn chart(mask: u16) -> Chart {
    Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: vec![Note {
            tick: 0,
            panel_mask: mask,
            hold_ticks: 0,
        }],
    }
}

fn runtime() -> TestResult<RuntimeProgram> {
    Ok(build_runtime(
        music()?,
        &[
            WeightedChart {
                chart: chart(1),
                prior_mass: Fraction::new(1, 6)?,
            },
            WeightedChart {
                chart: chart(1),
                prior_mass: Fraction::new(1, 3)?,
            },
            WeightedChart {
                chart: chart(2),
                prior_mass: Fraction::new(1, 2)?,
            },
        ],
        HistoryPolicy {
            recent_window: 2,
            max_request_history: 4,
        },
    )?)
}

#[test]
fn runtime_merges_duplicates_and_reduces_exact_weights() -> TestResult {
    let runtime = runtime()?;

    assert_eq!(runtime.candidates.len(), 2);
    assert_eq!(runtime.candidates[0].weight, 1);
    assert_eq!(runtime.candidates[1].weight, 1);
    assert_eq!(runtime.original_mass, Fraction::ONE);
    assert!(runtime.candidates[0].id < runtime.candidates[1].id);
    Ok(())
}

#[test]
fn history_excludes_recent_candidates_and_falls_back_when_exhausted() -> TestResult {
    let runtime = runtime()?;
    let first = runtime.candidates[0].id;
    let second = runtime.candidates[1].id;
    let excluded_one = GenerationRequest {
        seed: [9; 32],
        history: vec![first],
    };
    let exhausted = GenerationRequest {
        seed: [9; 32],
        history: vec![first, second],
    };

    let selected = generate(&runtime, &excluded_one)?;
    let fallback = generate(&runtime, &exhausted)?;

    assert_eq!(selected.candidate_id, second);
    assert_eq!(selected.history_conditioned_ratio, Fraction::ONE);
    assert!(!selected.allow_repeat_fallback);
    assert!(fallback.allow_repeat_fallback);
    assert_eq!(fallback.eligible_weight, 2);
    Ok(())
}

#[test]
fn generation_is_deterministic_and_hashes_request_and_program() -> TestResult {
    let runtime = runtime()?;
    let request = GenerationRequest {
        seed: [5; 32],
        history: Vec::new(),
    };

    let first = generate(&runtime, &request)?;
    let second = generate(&runtime, &request)?;

    assert_eq!(first, second);
    assert_ne!(first.program_sha256, [0; 32]);
    assert_ne!(first.request_sha256, [0; 32]);
    Ok(())
}

#[test]
fn deterministic_sampling_tracks_exact_candidate_weights() -> TestResult {
    let runtime = build_runtime(
        music()?,
        &[
            WeightedChart {
                chart: chart(1),
                prior_mass: Fraction::new(1, 4)?,
            },
            WeightedChart {
                chart: chart(2),
                prior_mass: Fraction::new(3, 4)?,
            },
        ],
        HistoryPolicy {
            recent_window: 0,
            max_request_history: 0,
        },
    )?;
    let heavy = runtime
        .candidates
        .iter()
        .find(|candidate| candidate.weight == 3)
        .ok_or(RuntimeError::NoCandidates)?
        .id;
    let heavy_ratio = Fraction::new(3, 4)?;
    let mut heavy_count = 0_u32;
    for value in 0..1_024_u64 {
        let mut seed = [0_u8; 32];
        seed[..8].copy_from_slice(&value.to_le_bytes());
        let generated = generate(
            &runtime,
            &GenerationRequest {
                seed,
                history: Vec::new(),
            },
        )?;
        if generated.candidate_id == heavy {
            heavy_count += 1;
        }
        if generated.candidate_id == heavy {
            assert_eq!(generated.base_ratio, heavy_ratio);
        }
    }

    assert!((700..=835).contains(&heavy_count));
    Ok(())
}

#[test]
fn request_codec_has_stable_golden_bytes() -> TestResult {
    let request = GenerationRequest {
        seed: [0; 32],
        history: Vec::new(),
    };

    let bytes = encode_generation_request(&request)?;

    assert_eq!(
        hex::encode(bytes),
        "504351320200000000000000000000000000000000000000000000000000000000000000000000000000"
    );
    Ok(())
}

#[test]
fn all_runtime_artifacts_round_trip_and_reject_malformed_bytes() -> TestResult {
    let runtime = runtime()?;
    let request = GenerationRequest {
        seed: [4; 32],
        history: vec![runtime.candidates[0].id],
    };
    let generated: GeneratedChart = generate(&runtime, &request)?;
    let runtime_bytes = encode_runtime_program(&runtime)?;
    let request_bytes = encode_generation_request(&request)?;
    let generated_bytes = encode_generated_chart(&generated)?;

    assert_eq!(
        decode_runtime_program(&runtime_bytes, &Limits::default())?,
        runtime
    );
    assert_eq!(
        decode_generation_request(&request_bytes, &Limits::default())?,
        request
    );
    assert_eq!(
        decode_generated_chart(&generated_bytes, &Limits::default())?,
        generated
    );
    let mut trailing = request_bytes.clone();
    trailing.push(0);
    assert!(decode_generation_request(&trailing, &Limits::default()).is_err());
    assert!(decode_runtime_program(&runtime_bytes[..8], &Limits::default()).is_err());
    let mut invalid_runtime = runtime.clone();
    invalid_runtime.candidates[0].weight = 2;
    assert!(encode_runtime_program(&invalid_runtime).is_err());

    let mut unreduced = runtime_bytes.clone();
    unreduced[38..54].copy_from_slice(&2_u128.to_le_bytes());
    unreduced[54..70].copy_from_slice(&2_u128.to_le_bytes());
    assert!(decode_runtime_program(&unreduced, &Limits::default()).is_err());
    Ok(())
}
