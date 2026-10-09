use std::collections::BTreeMap;
use std::fmt::Write as _;

use anyhow::{Context, Result, ensure};
use pump_chart::{Chart, Music};

const ROWS_PER_MEASURE: u64 = 192;
pub(crate) const MAX_SSC_BYTES: u64 = 32 * 1_024 * 1_024;
const SSC_LANES_BY_PANEL_BIT: [usize; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

pub struct SscInput<'a> {
    pub music: &'a Music,
    pub chart: &'a Chart,
    pub title: &'a str,
    pub artist: &'a str,
    pub audio_file: &'a str,
}

pub fn render(input: &SscInput<'_>) -> Result<Vec<u8>> {
    pump_chart::validate_music(input.music).context("validate SSC music")?;
    pump_chart::validate_chart(input.chart).context("validate SSC chart")?;
    ensure!(
        input.chart.ticks_per_beat == input.music.ticks_per_beat
            && input.chart.span_ticks == input.music.duration_ticks,
        "chart and music grids differ"
    );
    let title = crate::ssc_format::metadata(input.title, "title")?;
    let artist = crate::ssc_format::metadata(input.artist, "artist")?;
    ensure!(
        matches!(input.audio_file, "music.wav" | "music.ogg" | "music.mp3"),
        "unsupported SSC audio filename"
    );
    let bpms = crate::ssc_format::bpms(input.music)?;
    let offset = crate::ssc_format::offset(input.music.offset_micros)?;
    let mut header = String::new();
    writeln!(header, "#VERSION:0.83;")?;
    writeln!(header, "#TITLE:{title};")?;
    writeln!(header, "#ARTIST:{artist};")?;
    writeln!(header, "#MUSIC:{};", input.audio_file)?;
    writeln!(header, "#OFFSET:{offset};")?;
    writeln!(header, "#BPMS:{bpms};")?;
    writeln!(header, "#NOTEDATA:;")?;
    writeln!(header, "#STEPSTYPE:pump-double;")?;
    writeln!(header, "#CHARTNAME:Generated;")?;
    writeln!(header, "#DESCRIPTION:Deterministic pump chart export;")?;
    writeln!(header, "#CHARTSTYLE:;")?;
    writeln!(header, "#DIFFICULTY:Edit;")?;
    writeln!(header, "#METER:1;")?;
    writeln!(header, "#RADARVALUES:0,0,0,0,0;")?;
    writeln!(header, "#NOTES:")?;
    let (row_count, row_events) = rows(input.chart)?;
    let measure_count = row_count / ROWS_PER_MEASURE;
    let separator_bytes = measure_count
        .checked_sub(1)
        .and_then(|value| value.checked_mul(2))
        .context("SSC separator size overflow")?;
    let body_bytes = row_count
        .checked_mul(11)
        .and_then(|value| value.checked_add(separator_bytes))
        .and_then(|value| value.checked_add(2))
        .context("SSC output size overflow")?;
    let output_bytes = u64::try_from(header.len())
        .context("SSC header size conversion")?
        .checked_add(body_bytes)
        .context("SSC output size overflow")?;
    ensure!(output_bytes <= MAX_SSC_BYTES, "SSC output limit exceeded");
    let mut output = header;
    output
        .try_reserve(usize::try_from(body_bytes).context("SSC body size conversion")?)
        .context("reserve SSC output")?;
    write_rows(&mut output, row_count, &row_events)?;
    ensure!(
        u64::try_from(output.len()).context("SSC final size conversion")? <= MAX_SSC_BYTES,
        "SSC output limit exceeded"
    );
    Ok(output.into_bytes())
}

fn write_rows(
    output: &mut String,
    row_count: u64,
    row_events: &BTreeMap<u64, [u8; 10]>,
) -> Result<()> {
    for row in 0..row_count {
        let cells = row_events.get(&row).copied().unwrap_or([b'0'; 10]);
        output.push_str(std::str::from_utf8(&cells).context("encode SSC row")?);
        output.push('\n');
        if (row + 1) % ROWS_PER_MEASURE == 0 && row + 1 != row_count {
            output.push_str(",\n");
        }
    }
    output.push_str(";\n");
    Ok(())
}

fn rows(chart: &Chart) -> Result<(u64, BTreeMap<u64, [u8; 10]>)> {
    let mut positions = Vec::with_capacity(chart.notes.len().saturating_mul(2));
    let mut maximum = 0_u64;
    for note in &chart.notes {
        let head = crate::ssc_format::row(note.tick, chart.ticks_per_beat)?;
        positions.push((
            head,
            note.panel_mask,
            if note.hold_ticks == 0 { b'1' } else { b'2' },
        ));
        maximum = maximum.max(head);
        if note.hold_ticks > 0 {
            let tail_tick = note
                .tick
                .checked_add(note.hold_ticks)
                .context("hold tail overflow")?;
            let tail = crate::ssc_format::row(tail_tick, chart.ticks_per_beat)?;
            positions.push((tail, note.panel_mask, b'3'));
            maximum = maximum.max(tail);
        }
    }
    let measure_count = maximum
        .checked_div(ROWS_PER_MEASURE)
        .and_then(|value| value.checked_add(1))
        .context("SSC measure count overflow")?;
    let row_count = measure_count
        .checked_mul(ROWS_PER_MEASURE)
        .context("SSC row count overflow")?;
    let projected = row_count
        .checked_mul(11)
        .context("SSC output size overflow")?;
    ensure!(projected <= MAX_SSC_BYTES, "SSC output limit exceeded");
    let mut events = BTreeMap::<u64, [u8; 10]>::new();
    for (row, mask, token) in positions {
        let cells = events.entry(row).or_insert([b'0'; 10]);
        for (panel, lane) in SSC_LANES_BY_PANEL_BIT.iter().enumerate() {
            if mask & (1_u16 << panel) == 0 {
                continue;
            }
            ensure!(
                cells[*lane] == b'0',
                "SSC cell cannot contain a hold tail and a new onset"
            );
            cells[*lane] = token;
        }
    }
    Ok((row_count, events))
}
