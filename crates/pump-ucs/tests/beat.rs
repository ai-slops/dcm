use pump_chart::Fraction;
use pump_ucs::{
    Beat, BeatGridSection, BeatNote, BeatTempoSegment, BeatUcsChart, NativeProjectionError,
    UcsMode, parse_ucs, parse_ucs_beats, project_beats_native, render_ucs_beats,
};

fn coprime() -> String {
    let mut source =
        String::from(":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=127\nX....\n");
    source.push_str(&".....\n".repeat(127));
    source.push_str(":Split=113\n.X...\n");
    source.push_str(&".....\n".repeat(113));
    source
}

#[test]
fn beat_codec_roundtrips_section_local_coprime_splits() {
    let imported = parse_ucs_beats(coprime().as_bytes(), [9; 32]).expect("beat import");

    assert_eq!(imported.grid_sections[0].rows_per_measure, 508);
    assert_eq!(imported.grid_sections[1].rows_per_measure, 452);
    assert_eq!(
        imported.grid_sections[1].at,
        Beat::new(128, 127).expect("beat")
    );
    assert_eq!(imported.notes[1].at, Beat::new(128, 127).expect("beat"));

    let rendered = render_ucs_beats(&imported).expect("beat export");
    let reparsed = parse_ucs_beats(rendered.as_bytes(), [9; 32]).expect("reparse");
    assert_eq!(reparsed, imported);
}

#[test]
fn native_projection_rejects_required_grid_without_rounding() {
    let source = coprime();
    let imported = parse_ucs_beats(source.as_bytes(), [0; 32]).expect("direct UCS succeeds");
    assert!(
        parse_ucs(source.as_bytes(), [0; 32]).is_err(),
        "legacy global-grid import must remain bounded"
    );

    let error = project_beats_native(&imported).expect_err("native grid exceeds capability");

    assert_eq!(
        error,
        NativeProjectionError::GridUnsupported {
            required_tpb: 14_351,
            limit: 4_096,
        }
    );
}

#[test]
fn native_projection_preserves_exact_coordinates_when_supported() {
    let source =
        ":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=3\nX....\n.M...\n.H...\n.W...\n";
    let imported = parse_ucs_beats(source.as_bytes(), [4; 32]).expect("beat import");

    let native = project_beats_native(&imported).expect("native projection");

    assert_eq!(native.chart.ticks_per_beat, 3);
    assert_eq!(native.chart.notes[1].tick, 1);
    assert_eq!(native.chart.notes[1].hold_ticks, 2);
    assert_eq!(
        BeatUcsChart::try_from(native).expect("back to beats"),
        imported
    );
}

#[test]
fn beat_export_refines_arbitrary_measure_rows_without_rounding() {
    for (rows_per_measure, expected_split) in [(7, 7), (6, 3), (1, 1)] {
        let source = BeatUcsChart {
            mode: UcsMode::Single,
            offset_micros: 0,
            tempo: vec![BeatTempoSegment {
                at: Beat::new(0, 1).expect("zero"),
                micros_per_beat: Fraction::new(500_000, 1).expect("tempo"),
            }],
            grid_sections: vec![BeatGridSection {
                at: Beat::new(0, 1).expect("zero"),
                rows_per_measure,
            }],
            duration: Beat::new(4, 1).expect("measure"),
            notes: vec![BeatNote {
                at: Beat::new(
                    if rows_per_measure == 1 { 0 } else { 4 },
                    u64::from(rows_per_measure),
                )
                .expect("author row"),
                hold: Beat::new(
                    if rows_per_measure == 1 { 0 } else { 4 },
                    u64::from(rows_per_measure),
                )
                .expect("hold"),
                panel_mask: 1,
            }],
            audio_sha256: [0; 32],
            reference_accents: Vec::new(),
        };

        let rendered = render_ucs_beats(&source).expect("refined UCS grid");
        let reparsed = parse_ucs_beats(rendered.as_bytes(), [0; 32]).expect("reparse");

        assert!(rendered.contains(&format!(":Split={expected_split}\r\n")));
        assert_eq!(reparsed.notes, source.notes);
        assert_eq!(reparsed.tempo, source.tempo);
        assert_eq!(reparsed.duration, source.duration);
        assert_eq!(
            reparsed.grid_sections[0].rows_per_measure,
            expected_split * 4
        );
    }
}

#[test]
fn beat_export_rejects_measure_grid_requiring_split_above_128() {
    let source = BeatUcsChart {
        mode: UcsMode::Single,
        offset_micros: 0,
        tempo: vec![BeatTempoSegment {
            at: Beat::new(0, 1).expect("zero"),
            micros_per_beat: Fraction::new(500_000, 1).expect("tempo"),
        }],
        grid_sections: vec![BeatGridSection {
            at: Beat::new(0, 1).expect("zero"),
            rows_per_measure: 129,
        }],
        duration: Beat::new(4, 1).expect("measure"),
        notes: Vec::new(),
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };

    let error = render_ucs_beats(&source).expect_err("Split 129 must be rejected");

    assert!(error.to_string().contains("Split <= 128"));
}
