use anyhow::Context;
use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};

use crate::ssc::{MAX_SSC_BYTES, SscInput, render};

const ROW_BYTES_PER_MEASURE: u64 = 192 * 11 + 2;

fn render_measures(measures: u64, title: &str, artist: &str) -> anyhow::Result<Vec<u8>> {
    let duration_ticks = measures
        .checked_mul(192)
        .context("fixture duration overflow")?;
    let music = Music {
        duration_ticks,
        ticks_per_beat: 48,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };
    let chart = Chart {
        ticks_per_beat: 48,
        span_ticks: duration_ticks,
        notes: vec![Note {
            tick: duration_ticks - 1,
            panel_mask: 1,
            hold_ticks: 0,
        }],
    };
    render(&SscInput {
        music: &music,
        chart: &chart,
        title,
        artist,
        audio_file: "music.wav",
    })
}

#[test]
fn rendered_bytes_respect_the_actual_32_mib_limit() -> anyhow::Result<()> {
    let metadata = "#".repeat(256);
    let one_measure = render_measures(1, &metadata, &metadata)?;
    let header_bytes = u64::try_from(one_measure.len())? - ROW_BYTES_PER_MEASURE;
    let maximum_measures = (MAX_SSC_BYTES - header_bytes) / ROW_BYTES_PER_MEASURE;

    let maximum = render_measures(maximum_measures, &metadata, &metadata)?;
    let overflow = render_measures(maximum_measures + 1, &metadata, &metadata)
        .expect_err("one additional measure must exceed the byte limit");

    assert_eq!(
        u64::try_from(maximum.len())?,
        header_bytes + maximum_measures * ROW_BYTES_PER_MEASURE
    );
    assert!(u64::try_from(maximum.len())? <= MAX_SSC_BYTES);
    assert!(overflow.to_string().contains("output limit"));
    Ok(())
}
