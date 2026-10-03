use pump_chart::{
    Chart, Fraction, GeneratedChart, Note, candidate_id, encode_generated_chart, normalize_chart,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn chart(notes: Vec<Note>) -> Chart {
    Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes,
    }
}

#[test]
fn split_disjoint_taps_have_the_same_candidate_identity_as_combined_taps() -> TestResult {
    let split = chart(vec![
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
    ]);
    let combined = chart(vec![Note {
        tick: 0,
        panel_mask: 3,
        hold_ticks: 0,
    }]);

    assert_eq!(normalize_chart(&split)?, combined);
    assert_eq!(candidate_id(&split)?, candidate_id(&combined)?);
    Ok(())
}

#[test]
fn split_identical_holds_merge_but_duplicate_panel_demands_fail() -> TestResult {
    let disjoint = chart(vec![
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 4,
        },
        Note {
            tick: 0,
            panel_mask: 2,
            hold_ticks: 4,
        },
    ]);
    let duplicate = chart(vec![
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 0,
        },
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 0,
        },
    ]);

    assert_eq!(normalize_chart(&disjoint)?.notes[0].panel_mask, 3);
    assert!(normalize_chart(&duplicate).is_err());
    Ok(())
}

#[test]
fn generated_chart_codec_rejects_split_unnormalized_groups() -> TestResult {
    let split = chart(vec![
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
    ]);
    let generated = GeneratedChart {
        candidate_id: candidate_id(&split)?,
        chart: split,
        program_sha256: [0; 32],
        request_sha256: [0; 32],
        base_ratio: Fraction::ONE,
        history_conditioned_ratio: Fraction::ONE,
        eligible_weight: 1,
        allow_repeat_fallback: false,
    };

    assert!(encode_generated_chart(&generated).is_err());
    Ok(())
}
