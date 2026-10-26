use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};
use pump_ucs::{UcsMode, parse_ucs, render_ucs};

fn music(ticks: u64, tpb: u32, offset: i64, tempo: Vec<TempoSegment>) -> Music {
    Music {
        duration_ticks: ticks,
        ticks_per_beat: tpb,
        offset_micros: offset,
        tempo,
        audio_sha256: [3; 32],
        reference_accents: Vec::new(),
    }
}

#[test]
fn render_is_canonical_ascii_crlf_and_roundtrips() {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 5,
        notes: vec![
            Note {
                tick: 0,
                panel_mask: 0b1_0001,
                hold_ticks: 0,
            },
            Note {
                tick: 1,
                panel_mask: 0b10,
                hold_ticks: 3,
            },
            Note {
                tick: 2,
                panel_mask: 0b100,
                hold_ticks: 0,
            },
        ],
    };
    let music = music(
        5,
        4,
        -1_250,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1).expect("fraction"),
        }],
    );

    let text = render_ucs(&chart, &music, UcsMode::Single).expect("representable");
    let parsed = parse_ucs(text.as_bytes(), [3; 32]).expect("rendered UCS parses");

    assert!(text.is_ascii());
    assert!(text.ends_with("\r\n"));
    assert!(!text.replace("\r\n", "").contains('\n'));
    assert!(text.contains(":Format=1\r\n:Mode=Single\r\n"));
    assert!(text.contains(":Delay=-1.25\r\n"));
    assert_eq!(parsed.chart, chart);
    assert_eq!(parsed.music, music);
}

#[test]
fn render_roundtrips_variable_tempo_and_reduced_grid() {
    let chart = Chart {
        ticks_per_beat: 384,
        span_ticks: 768,
        notes: vec![Note {
            tick: 192,
            panel_mask: 0x201,
            hold_ticks: 384,
        }],
    };
    let music = music(
        768,
        384,
        0,
        vec![
            TempoSegment {
                start_tick: 0,
                micros_per_beat: Fraction::new(500_000, 1).expect("fraction"),
            },
            TempoSegment {
                start_tick: 384,
                micros_per_beat: Fraction::new(400_000, 1).expect("fraction"),
            },
        ],
    );

    let text = render_ucs(&chart, &music, UcsMode::Double).expect("grid reduces");
    let parsed = parse_ucs(text.as_bytes(), [3; 32]).expect("rendered UCS parses");

    assert!(text.contains(":Split=2\r\n"));
    assert_eq!(parsed.chart.ticks_per_beat, 2);
    assert_eq!(
        parsed.chart.notes[0],
        Note {
            tick: 1,
            panel_mask: 0x201,
            hold_ticks: 2
        }
    );
    assert_eq!(parsed.music.tempo.len(), 2);
}

#[test]
fn render_preserves_low_resolution_grid_even_when_events_share_factor() {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 8,
        notes: vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 4,
        }],
    };
    let music = music(
        8,
        4,
        0,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1).expect("fraction"),
        }],
    );

    let text = render_ucs(&chart, &music, UcsMode::Single).expect("low grid remains exact");
    let parsed = parse_ucs(text.as_bytes(), [3; 32]).expect("rendered UCS parses");

    assert!(text.contains(":Split=4\r\n"));
    assert_eq!(parsed.chart, chart);
    assert_eq!(parsed.music, music);
}

#[test]
fn render_rejects_more_than_supported_section_count() {
    let chart = Chart {
        ticks_per_beat: 1,
        span_ticks: 4_098,
        notes: Vec::new(),
    };
    let tempo = (0..4_097_u64)
        .map(|start_tick| TempoSegment {
            start_tick,
            micros_per_beat: Fraction::new(500_000 + u128::from(start_tick % 2), 1)
                .expect("fraction"),
        })
        .collect();
    let music = music(4_098, 1, 0, tempo);

    let error = render_ucs(&chart, &music, UcsMode::Single).expect_err("section cap");

    assert!(error.to_string().contains("section count"));
}

#[test]
fn render_single_rejection_guides_user_to_double_mode() {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: vec![Note {
            tick: 0,
            panel_mask: 1 << 5,
            hold_ticks: 0,
        }],
    };
    let music = music(
        4,
        4,
        0,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1).expect("fraction"),
        }],
    );

    let error = render_ucs(&chart, &music, UcsMode::Single).expect_err("right pad needs Double");

    assert_eq!(
        error.to_string(),
        "UCS chart cannot be represented in the supported profile: Single mode cannot represent right-pad notes; choose Double"
    );
}

#[test]
fn render_rejects_tail_onset_and_non_decimal_tempo() {
    let colliding = Chart {
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
                hold_ticks: 0,
            },
        ],
    };
    let exact = music(
        8,
        4,
        0,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1).expect("fraction"),
        }],
    );
    assert!(render_ucs(&colliding, &exact, UcsMode::Single).is_err());

    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: Vec::new(),
    };
    let repeating = music(
        4,
        4,
        0,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(7, 1).expect("fraction"),
        }],
    );
    assert!(render_ucs(&chart, &repeating, UcsMode::Single).is_err());
}

#[test]
fn render_error_display_has_stable_ucs_prefix() {
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: Vec::new(),
    };
    let music = music(
        4,
        4,
        0,
        vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(7, 1).expect("fraction"),
        }],
    );

    let error = render_ucs(&chart, &music, UcsMode::Single).expect_err("tempo is inexact");

    assert!(error.to_string().starts_with("UCS "));
}
