use pump_chart::Fraction;
use pump_ucs::{
    Beat, BeatGridSection, BeatNote, BeatTempoSegment, BeatUcsChart, UcsMode, parse_ucs_beats,
    render_ucs_beats,
};

#[test]
fn beat_import_rejects_raw_lane_notes_before_sorting() {
    let mut source = String::from(":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=1\n");
    source.push_str(&"XXXXX\n".repeat(20_001));

    let error = parse_ucs_beats(source.as_bytes(), [0; 32]).expect_err("raw note cap");

    assert_eq!(error, pump_ucs::UcsError::Limit("raw lane note count"));
}

#[test]
fn beat_export_rejects_invalid_marker_and_note_invariants_before_rendering() {
    let base = BeatUcsChart {
        mode: UcsMode::Single,
        offset_micros: 0,
        tempo: vec![BeatTempoSegment {
            at: Beat::new(0, 1).expect("zero"),
            micros_per_beat: Fraction::new(500_000, 1).expect("tempo"),
        }],
        grid_sections: vec![BeatGridSection {
            at: Beat::new(0, 1).expect("zero"),
            rows_per_measure: 4,
        }],
        duration: Beat::new(4, 1).expect("duration"),
        notes: vec![BeatNote {
            at: Beat::new(1, 1).expect("note"),
            hold: Beat::new(0, 1).expect("tap"),
            panel_mask: 1,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };
    let tempo = BeatTempoSegment {
        at: Beat::new(2, 1).expect("marker"),
        micros_per_beat: Fraction::new(400_000, 1).expect("tempo"),
    };
    let grid = BeatGridSection {
        at: Beat::new(2, 1).expect("marker"),
        rows_per_measure: 8,
    };
    let cases = [
        BeatUcsChart {
            tempo: vec![base.tempo[0].clone(), tempo.clone(), tempo.clone()],
            ..base.clone()
        },
        BeatUcsChart {
            tempo: vec![tempo.clone(), base.tempo[0].clone()],
            ..base.clone()
        },
        BeatUcsChart {
            tempo: vec![
                base.tempo[0].clone(),
                BeatTempoSegment {
                    at: base.duration,
                    ..tempo.clone()
                },
            ],
            ..base.clone()
        },
        BeatUcsChart {
            grid_sections: vec![base.grid_sections[0].clone(), grid.clone(), grid],
            ..base.clone()
        },
        BeatUcsChart {
            grid_sections: vec![
                BeatGridSection {
                    at: Beat::new(2, 1).expect("marker"),
                    rows_per_measure: 4,
                },
                base.grid_sections[0].clone(),
            ],
            ..base.clone()
        },
        BeatUcsChart {
            grid_sections: vec![
                base.grid_sections[0].clone(),
                BeatGridSection {
                    at: base.duration,
                    rows_per_measure: 8,
                },
            ],
            ..base.clone()
        },
        BeatUcsChart {
            notes: vec![base.notes[0].clone(), base.notes[0].clone()],
            ..base.clone()
        },
        BeatUcsChart {
            notes: vec![
                BeatNote {
                    at: Beat::new(2, 1).expect("later"),
                    ..base.notes[0].clone()
                },
                base.notes[0].clone(),
            ],
            ..base.clone()
        },
        BeatUcsChart {
            notes: vec![
                BeatNote {
                    hold: Beat::new(1, 1).expect("hold"),
                    ..base.notes[0].clone()
                },
                BeatNote {
                    at: Beat::new(3, 2).expect("overlap"),
                    ..base.notes[0].clone()
                },
            ],
            ..base.clone()
        },
        BeatUcsChart {
            notes: vec![BeatNote {
                panel_mask: 0,
                ..base.notes[0].clone()
            }],
            ..base.clone()
        },
        BeatUcsChart {
            notes: vec![BeatNote {
                at: base.duration,
                ..base.notes[0].clone()
            }],
            ..base.clone()
        },
        BeatUcsChart {
            reference_accents: vec![Beat::new(1, 1).expect("accent")],
            ..base
        },
    ];

    for chart in cases {
        assert!(
            render_ucs_beats(&chart).is_err(),
            "accepted invalid chart {chart:?}"
        );
    }
}
