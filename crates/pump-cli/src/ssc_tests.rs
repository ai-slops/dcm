use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};

use crate::ssc::{SscInput, render};

fn music(ticks_per_beat: u32, micros_per_beat: Fraction) -> Music {
    Music {
        duration_ticks: u64::from(ticks_per_beat) * 8,
        ticks_per_beat,
        offset_micros: 100_000,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat,
        }],
        audio_sha256: [7; 32],
        reference_accents: Vec::new(),
    }
}

fn chart(ticks_per_beat: u32, notes: Vec<Note>) -> Chart {
    Chart {
        ticks_per_beat,
        span_ticks: u64::from(ticks_per_beat) * 8,
        notes,
    }
}

fn input<'a>(music: &'a Music, chart: &'a Chart, title: &'a str) -> SscInput<'a> {
    SscInput {
        music,
        chart,
        title,
        artist: "Artist",
        audio_file: "music.wav",
    }
}

#[test]
fn renders_pump_double_rows_and_next_measure_hold_tail() -> anyhow::Result<()> {
    let music = music(4, Fraction::new(500_000, 1)?);
    let chart = chart(
        4,
        vec![
            Note {
                tick: 0,
                panel_mask: (1 << 0) | (1 << 9),
                hold_ticks: 16,
            },
            Note {
                tick: 4,
                panel_mask: (1 << 2) | (1 << 7),
                hold_ticks: 0,
            },
        ],
    );

    let rendered = String::from_utf8(render(&input(&music, &chart, "Title"))?)?;

    assert!(rendered.contains("#STEPSTYPE:pump-double;"));
    assert!(rendered.contains("2000000002\n"));
    assert!(rendered.contains("0010000100\n"));
    assert!(rendered.contains(",\n3000000003\n"));
    assert!(rendered.contains("#BPMS:0=120;"));
    assert!(rendered.contains("#OFFSET:-0.1;"));
    Ok(())
}

#[test]
fn escapes_metadata_control_tokens() -> anyhow::Result<()> {
    let music = music(4, Fraction::new(500_000, 1)?);
    let chart = chart(4, Vec::new());

    let rendered = String::from_utf8(render(&input(&music, &chart, r"A\#B:C;D"))?)?;

    assert!(rendered.contains(r"#TITLE:A\\\#B\:C\;D;"));
    Ok(())
}

#[test]
fn rejects_comment_or_line_break_metadata() -> anyhow::Result<()> {
    let music = music(4, Fraction::new(500_000, 1)?);
    let chart = chart(4, Vec::new());

    let comment = render(&input(&music, &chart, "unsafe//comment"));
    let line_break = render(&input(&music, &chart, "unsafe\nline"));

    assert!(comment.is_err());
    assert!(line_break.is_err());
    Ok(())
}

#[test]
fn rejects_note_outside_192_row_grid() -> anyhow::Result<()> {
    let music = music(7, Fraction::new(500_000, 1)?);
    let chart = chart(
        7,
        vec![Note {
            tick: 1,
            panel_mask: 1,
            hold_ticks: 0,
        }],
    );

    let error = render(&input(&music, &chart, "Title")).expect_err("row must be exact");

    assert!(error.to_string().contains("192-row grid"));
    Ok(())
}

#[test]
fn rejects_nonterminating_bpm_or_beat_decimal() -> anyhow::Result<()> {
    let nonterminating_bpm = music(4, Fraction::new(70_001, 1)?);
    let base_chart = chart(4, Vec::new());
    let bpm_error =
        render(&input(&nonterminating_bpm, &base_chart, "Title")).expect_err("BPM must terminate");

    let mut nonterminating_beat = music(48, Fraction::new(500_000, 1)?);
    nonterminating_beat.tempo.push(TempoSegment {
        start_tick: 1,
        micros_per_beat: Fraction::new(400_000, 1)?,
    });
    let beat_chart = chart(48, Vec::new());
    let beat_error = render(&input(&nonterminating_beat, &beat_chart, "Title"))
        .expect_err("beat must terminate");

    assert!(bpm_error.to_string().contains("terminating decimal"));
    assert!(beat_error.to_string().contains("terminating decimal"));
    Ok(())
}

#[test]
fn rejects_tail_and_new_onset_in_same_cell() -> anyhow::Result<()> {
    let music = music(4, Fraction::new(500_000, 1)?);
    let chart = chart(
        4,
        vec![
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
    );

    let error = render(&input(&music, &chart, "Title")).expect_err("cell collision");

    assert!(error.to_string().contains("hold tail"));
    Ok(())
}

#[test]
fn rejects_output_larger_than_export_profile() -> anyhow::Result<()> {
    let mut music = music(4, Fraction::new(500_000, 1)?);
    music.duration_ticks = 2_000_000;
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 2_000_000,
        notes: vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 2_000_000,
        }],
    };

    let error = render(&input(&music, &chart, "Title")).expect_err("output bound");

    assert!(error.to_string().contains("output limit"));
    Ok(())
}
