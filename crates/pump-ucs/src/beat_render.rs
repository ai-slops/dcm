use std::collections::{BTreeMap, BTreeSet};

use crate::beat::{Beat, BeatUcsChart, gcd};
use crate::decimal::{JS_SAFE, format_decimal};
use crate::{UcsError, UcsMode};

const MAX_ROWS: usize = 1_000_000;
const MAX_BYTES: usize = 16 * 1024 * 1024;

pub fn render_ucs_beats(chart: &BeatUcsChart) -> Result<String, UcsError> {
    validate(chart)?;
    let mut boundaries = BTreeSet::new();
    boundaries.extend(chart.tempo.iter().map(|segment| segment.at));
    boundaries.extend(chart.grid_sections.iter().map(|section| section.at));
    boundaries.insert(chart.duration);
    let boundaries: Vec<Beat> = boundaries.into_iter().collect();
    if boundaries.len() > 4_097 {
        return Err(UcsError::Unrepresentable("section count exceeds 4096"));
    }

    let mut row_beats = Vec::new();
    let mut section_rows = Vec::new();
    for window in boundaries.windows(2) {
        let start = window[0];
        let end = window[1];
        section_rows.push(row_beats.len());
        let rows_per_measure = active_grid(chart, start)?;
        let split = ucs_split(rows_per_measure)?;
        let delta = end.checked_sub(start)?;
        let scaled = u128::from(delta.numerator()) * u128::from(rows_per_measure);
        let divisor = u128::from(delta.denominator()) * 4;
        if !scaled.is_multiple_of(divisor) {
            return Err(UcsError::Unrepresentable(
                "section boundary is not aligned to its local grid",
            ));
        }
        let output_scaled = u128::from(delta.numerator()) * u128::from(split);
        if !output_scaled.is_multiple_of(u128::from(delta.denominator())) {
            return Err(UcsError::Unrepresentable(
                "section boundary cannot be represented on the refined UCS grid",
            ));
        }
        let rows = usize::try_from(output_scaled / u128::from(delta.denominator()))
            .map_err(|_| UcsError::Overflow)?;
        for row in 0..rows {
            row_beats.push(start.checked_add(Beat::new(
                u64::try_from(row).map_err(|_| UcsError::Overflow)?,
                u64::from(split),
            )?)?);
        }
        if row_beats.len() > MAX_ROWS {
            return Err(UcsError::Unrepresentable(
                "row count is outside the supported range",
            ));
        }
    }
    let row_index: BTreeMap<Beat, usize> = row_beats
        .iter()
        .copied()
        .enumerate()
        .map(|(index, beat)| (beat, index))
        .collect();
    let mut cells = vec![vec![b'.'; chart.mode.lanes()]; row_beats.len()];
    for note in &chart.notes {
        let start = *row_index.get(&note.at).ok_or(UcsError::Unrepresentable(
            "note onset is not aligned to the local grid",
        ))?;
        let end_beat = note.at.checked_add(note.hold)?;
        let end = if note.hold.numerator() == 0 {
            start
        } else {
            *row_index.get(&end_beat).ok_or(UcsError::Unrepresentable(
                "hold tail is not aligned to the local grid",
            ))?
        };
        for lane in 0..chart.mode.lanes() {
            if note.panel_mask & (1_u16 << u32::try_from(lane).map_err(|_| UcsError::Overflow)?)
                == 0
            {
                continue;
            }
            set_cell(
                &mut cells,
                start,
                lane,
                if start == end { b'X' } else { b'M' },
            )?;
            if start != end {
                for row in start + 1..end {
                    set_cell(&mut cells, row, lane, b'H')?;
                }
                set_cell(&mut cells, end, lane, b'W')?;
            }
        }
    }

    let mut output = String::from(":Format=1\r\n");
    output.push_str(match chart.mode {
        UcsMode::Single => ":Mode=Single\r\n",
        UcsMode::Double => ":Mode=Double\r\n",
    });
    for (section_index, window) in boundaries.windows(2).enumerate() {
        write_header(&mut output, chart, window[0], section_index == 0)?;
        let start = section_rows[section_index];
        let end = section_rows
            .get(section_index + 1)
            .copied()
            .unwrap_or(cells.len());
        for row in &cells[start..end] {
            output.push_str(std::str::from_utf8(row).map_err(|_| UcsError::Overflow)?);
            output.push_str("\r\n");
        }
    }
    if output.len() > MAX_BYTES {
        return Err(UcsError::Unrepresentable(
            "rendered UCS exceeds the supported byte count",
        ));
    }
    Ok(output)
}

fn validate(chart: &BeatUcsChart) -> Result<(), UcsError> {
    if chart.duration.numerator() == 0 || chart.notes.len() > 10_000 {
        return Err(UcsError::Unrepresentable("chart bounds are invalid"));
    }
    if chart.tempo.first().map(|segment| segment.at) != Some(Beat::new(0, 1)?)
        || chart.grid_sections.first().map(|section| section.at) != Some(Beat::new(0, 1)?)
    {
        return Err(UcsError::Unrepresentable(
            "tempo and grid must start at beat zero",
        ));
    }
    if chart.mode == UcsMode::Single
        && chart
            .notes
            .iter()
            .any(|note| note.panel_mask & !0x001f != 0)
    {
        return Err(UcsError::Unrepresentable(
            "Single mode cannot represent right-pad notes; choose Double",
        ));
    }
    for section in &chart.grid_sections {
        if !(1..=512).contains(&section.rows_per_measure) {
            return Err(UcsError::Unrepresentable(
                "rows_per_measure must be between 1 and 512",
            ));
        }
        ucs_split(section.rows_per_measure)?;
    }
    Ok(())
}

fn active_grid(chart: &BeatUcsChart, at: Beat) -> Result<u16, UcsError> {
    chart
        .grid_sections
        .iter()
        .rev()
        .find(|section| section.at <= at)
        .map(|section| section.rows_per_measure)
        .ok_or(UcsError::Unrepresentable("missing local grid"))
}

fn write_header(
    output: &mut String,
    chart: &BeatUcsChart,
    at: Beat,
    first: bool,
) -> Result<(), UcsError> {
    let tempo = chart
        .tempo
        .iter()
        .rev()
        .find(|segment| segment.at <= at)
        .ok_or(UcsError::Unrepresentable("missing tempo"))?;
    let bpm_numerator = 60_000_000_u128
        .checked_mul(tempo.micros_per_beat.denominator())
        .ok_or(UcsError::Overflow)?;
    let bpm = format_decimal(bpm_numerator, tempo.micros_per_beat.numerator(), 6)?;
    let delay_magnitude = u128::from(chart.offset_micros.unsigned_abs());
    if delay_magnitude > JS_SAFE {
        return Err(UcsError::Unrepresentable(
            "offset exceeds the Studio numeric profile",
        ));
    }
    output.push_str(":BPM=");
    output.push_str(&bpm);
    output.push_str("\r\n:Delay=");
    if first && chart.offset_micros < 0 {
        output.push('-');
    }
    output.push_str(&format_decimal(
        if first { delay_magnitude } else { 0 },
        1_000,
        3,
    )?);
    output.push_str("\r\n:Beat=4\r\n:Split=");
    output.push_str(&ucs_split(active_grid(chart, at)?)?.to_string());
    output.push_str("\r\n");
    Ok(())
}

fn ucs_split(rows_per_measure: u16) -> Result<u16, UcsError> {
    let divisor =
        u16::try_from(gcd(4, u64::from(rows_per_measure))).map_err(|_| UcsError::Overflow)?;
    let split = rows_per_measure / divisor;
    if split > 128 {
        return Err(UcsError::Unrepresentable(
            "local grid cannot refine to UCS Split <= 128",
        ));
    }
    Ok(split)
}

fn set_cell(cells: &mut [Vec<u8>], row: usize, lane: usize, value: u8) -> Result<(), UcsError> {
    let cell = cells
        .get_mut(row)
        .and_then(|line| line.get_mut(lane))
        .ok_or(UcsError::Unrepresentable(
            "hold tail lies at the chart span",
        ))?;
    if *cell != b'.' {
        return Err(UcsError::Unrepresentable(
            "a cell cannot encode a hold tail and another onset",
        ));
    }
    *cell = value;
    Ok(())
}
