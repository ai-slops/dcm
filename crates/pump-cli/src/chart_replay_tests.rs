use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};

use crate::chart_export::replay_exact;
use crate::ssc::{SscInput, render};

fn music(duration_ticks: u64) -> anyhow::Result<Music> {
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

fn chart(span_ticks: u64, notes: Vec<Note>) -> Chart {
    Chart {
        ticks_per_beat: 4,
        span_ticks,
        notes,
    }
}

fn ssc(music: &Music, chart: &Chart) -> anyhow::Result<Vec<u8>> {
    render(&SscInput {
        music,
        chart,
        title: "Title",
        artist: "Artist",
        audio_file: "music.wav",
    })
}

#[test]
fn replay_distinguishes_empty_charts_with_different_exact_spans() -> anyhow::Result<()> {
    let short_music = music(4)?;
    let long_music = music(8)?;
    let short_chart = chart(4, Vec::new());
    let long_chart = chart(8, Vec::new());

    let short_ssc = ssc(&short_music, &short_chart)?;
    let long_ssc = ssc(&long_music, &long_chart)?;
    let short_replay = serde_json::to_value(replay_exact(&short_chart, &short_music))?;
    let long_replay = serde_json::to_value(replay_exact(&long_chart, &long_music))?;

    assert_eq!(short_ssc, long_ssc);
    assert_ne!(short_replay, long_replay);
    assert_eq!(short_replay["chart"]["span_ticks"], 4);
    assert_eq!(long_replay["music"]["duration_ticks"], 8);
    Ok(())
}

#[test]
fn replay_preserves_partial_measure_trailing_rest() -> anyhow::Result<()> {
    let note = Note {
        tick: 0,
        panel_mask: 1,
        hold_ticks: 0,
    };
    let short_music = music(4)?;
    let long_music = music(12)?;
    let short_chart = chart(4, vec![note]);
    let long_chart = chart(12, vec![note]);

    let short_ssc = ssc(&short_music, &short_chart)?;
    let long_ssc = ssc(&long_music, &long_chart)?;
    let short_replay = serde_json::to_value(replay_exact(&short_chart, &short_music))?;
    let long_replay = serde_json::to_value(replay_exact(&long_chart, &long_music))?;

    assert_eq!(short_ssc, long_ssc);
    assert_ne!(short_replay, long_replay);
    assert_eq!(
        long_replay["chart"]["notes"],
        short_replay["chart"]["notes"]
    );
    Ok(())
}
