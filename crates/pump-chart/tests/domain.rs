use pump_chart::{
    Chart, Fraction, FractionError, Music, Note, TempoSegment, elapsed_time, frames,
    normalize_chart, song_time, validate_chart,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn music() -> Result<Music, FractionError> {
    Ok(Music {
        duration_ticks: 8,
        ticks_per_beat: 4,
        offset_micros: -250_000,
        tempo: vec![
            TempoSegment {
                start_tick: 0,
                micros_per_beat: Fraction::new(500_000, 1)?,
            },
            TempoSegment {
                start_tick: 4,
                micros_per_beat: Fraction::new(1_000_000, 1)?,
            },
        ],
        audio_sha256: [7; 32],
        reference_accents: vec![0, 4],
    })
}

#[test]
fn fraction_reduces_and_orders_without_cross_product_overflow() -> TestResult {
    let half = Fraction::new(2, 4)?;
    let near_one = Fraction::new(u128::MAX - 1, u128::MAX)?;

    assert_eq!(half.numerator(), 1);
    assert_eq!(half.denominator(), 2);
    assert!(near_one > half);
    assert_eq!(half.checked_add(half)?, Fraction::ONE);
    Ok(())
}

#[test]
fn timing_integrates_changes_and_signed_offset_exactly() -> TestResult {
    let music = music()?;

    assert_eq!(elapsed_time(&music, 0, 4)?, Fraction::new(500_000, 1)?);
    assert_eq!(elapsed_time(&music, 4, 8)?, Fraction::new(1_000_000, 1)?);
    assert!(song_time(&music, 0)?.negative);
    assert_eq!(song_time(&music, 0)?.magnitude, Fraction::new(250_000, 1)?);
    assert_eq!(
        song_time(&music, 8)?.magnitude,
        Fraction::new(1_250_000, 1)?
    );
    Ok(())
}

#[test]
fn chart_allows_release_before_press_at_same_tick() -> TestResult {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 8,
        notes: vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 4,
            },
            Note {
                tick: 4,
                panel_mask: 1,
                hold_ticks: 4,
            },
        ],
    };

    validate_chart(&chart)?;
    let frames = frames(&chart)?;
    assert_eq!(frames[1].tick, 4);
    assert_eq!(frames[1].releases, 1);
    assert_eq!(frames[1].presses, 1);
    Ok(())
}

#[test]
fn chart_rejects_taps_at_end_and_overlapping_holds() {
    let at_end = Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: vec![Note {
            tick: 4,
            panel_mask: 1,
            hold_ticks: 0,
        }],
    };
    let overlap = Chart {
        ticks_per_beat: 4,
        span_ticks: 8,
        notes: vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 6,
            },
            Note {
                tick: 4,
                panel_mask: 1,
                hold_ticks: 0,
            },
        ],
    };

    assert!(validate_chart(&at_end).is_err());
    assert!(validate_chart(&overlap).is_err());
}

#[test]
fn chart_rejects_zero_span_even_when_empty() {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 0,
        notes: Vec::new(),
    };

    assert!(validate_chart(&chart).is_err());
}

#[test]
fn normalization_sorts_notes_canonically() -> TestResult {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 8,
        notes: vec![
            Note {
                tick: 4,
                panel_mask: 2,
                hold_ticks: 0,
            },
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0,
            },
        ],
    };

    let normalized = normalize_chart(&chart)?;
    assert_eq!(normalized.notes[0].tick, 0);
    Ok(())
}

#[test]
fn frames_include_silent_chart_boundaries() -> TestResult {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 8,
        notes: Vec::new(),
    };

    let frames = frames(&chart)?;

    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].tick, 0);
    assert_eq!(frames[1].tick, 8);
    Ok(())
}

#[test]
fn configuration_models_reject_unknown_json_fields() {
    let limits = r#"{
        "max_nodes":4096,"max_depth":128,"max_edges":16384,"max_derivations":4096,
        "max_trace_notes":65536,"max_total_events":1048576,"max_work":4194304,
        "max_string_bytes":256,"max_codec_bytes":67108864,"surprise":true
    }"#;
    let tempo = r#"{"start_tick":0,"micros_per_beat":{"numerator":1,"denominator":1},"bpm":120}"#;

    assert!(serde_json::from_str::<pump_chart::Limits>(limits).is_err());
    assert!(serde_json::from_str::<TempoSegment>(tempo).is_err());
}

#[test]
fn fraction_json_rejects_zero_denominators() {
    let invalid = r#"{"numerator":1,"denominator":0}"#;

    assert!(serde_json::from_str::<Fraction>(invalid).is_err());
}
