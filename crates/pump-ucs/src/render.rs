use pump_chart::{Chart, Music, Note, TempoSegment};

use crate::decimal::{JS_SAFE, format_decimal};
use crate::{UcsError, UcsMode};

const MAX_ROWS: u64 = 1_000_000;
const MAX_SECTIONS: usize = 4_096;
const MAX_BYTES: usize = 16 * 1024 * 1024;

pub fn render_ucs(chart: &Chart, music: &Music, mode: UcsMode) -> Result<String, UcsError> {
    pump_chart::validate_chart(chart).map_err(|error| UcsError::Chart(error.to_string()))?;
    pump_chart::validate_music(music).map_err(|error| UcsError::Music(error.to_string()))?;
    if chart.ticks_per_beat != music.ticks_per_beat || chart.span_ticks != music.duration_ticks {
        return Err(UcsError::GridMismatch);
    }
    if music.tempo.len() > MAX_SECTIONS {
        return Err(UcsError::Unrepresentable("section count exceeds 4096"));
    }
    validate_mode(chart, mode)?;
    let divisor = if chart.ticks_per_beat <= 128 {
        1
    } else {
        grid_divisor(chart, music)
    };
    let split = u64::from(chart.ticks_per_beat) / divisor;
    if split == 0 || split > 128 {
        return Err(UcsError::Unrepresentable(
            "timing grid cannot reduce to Split <= 128",
        ));
    }
    let rows = chart.span_ticks / divisor;
    if rows == 0 || rows > MAX_ROWS {
        return Err(UcsError::Unrepresentable(
            "row count is outside the supported range",
        ));
    }
    let mut cells =
        vec![vec![b'.'; mode.lanes()]; usize::try_from(rows).map_err(|_| UcsError::Overflow)?];
    for note in &chart.notes {
        write_note(&mut cells, note, divisor, mode)?;
    }
    let mut output = String::new();
    output.push_str(":Format=1\r\n");
    output.push_str(match mode {
        UcsMode::Single => ":Mode=Single\r\n",
        UcsMode::Double => ":Mode=Double\r\n",
    });
    for (index, segment) in music.tempo.iter().enumerate() {
        let start = segment.start_tick / divisor;
        let end = music
            .tempo
            .get(index + 1)
            .map_or(rows, |next| next.start_tick / divisor);
        write_header(
            &mut output,
            segment,
            if index == 0 { music.offset_micros } else { 0 },
            split,
        )?;
        for row in start..end {
            let row = cells
                .get(usize::try_from(row).map_err(|_| UcsError::Overflow)?)
                .ok_or(UcsError::Overflow)?;
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

fn validate_mode(chart: &Chart, mode: UcsMode) -> Result<(), UcsError> {
    match mode {
        UcsMode::Single
            if chart
                .notes
                .iter()
                .any(|note| note.panel_mask & !0x001f != 0) =>
        {
            return Err(UcsError::Unrepresentable(
                "Single mode cannot represent right-pad notes; choose Double",
            ));
        }
        UcsMode::Single | UcsMode::Double => {}
    }
    if chart.notes.len() > 10_000 {
        return Err(UcsError::Unrepresentable(
            "canonical note count exceeds 10000",
        ));
    }
    if music_safe_offset(chart).is_err() {
        return Err(UcsError::Unrepresentable(
            "tick values exceed the Studio numeric profile",
        ));
    }
    Ok(())
}

fn music_safe_offset(chart: &Chart) -> Result<(), UcsError> {
    if u128::from(chart.span_ticks) > JS_SAFE || u128::from(chart.ticks_per_beat) > JS_SAFE {
        return Err(UcsError::Overflow);
    }
    Ok(())
}

fn grid_divisor(chart: &Chart, music: &Music) -> u64 {
    let mut divisor = u64::from(chart.ticks_per_beat);
    divisor = gcd64(divisor, chart.span_ticks);
    for note in &chart.notes {
        divisor = gcd64(divisor, note.tick);
        divisor = gcd64(divisor, note.hold_ticks);
    }
    for segment in &music.tempo {
        divisor = gcd64(divisor, segment.start_tick);
    }
    divisor.max(1)
}

fn write_note(
    cells: &mut [Vec<u8>],
    note: &Note,
    divisor: u64,
    mode: UcsMode,
) -> Result<(), UcsError> {
    let start = note.tick / divisor;
    let end = note
        .tick
        .checked_add(note.hold_ticks)
        .ok_or(UcsError::Overflow)?
        / divisor;
    for lane in 0..mode.lanes() {
        let shift = u32::try_from(lane).map_err(|_| UcsError::Overflow)?;
        if note.panel_mask & (1_u16 << shift) == 0 {
            continue;
        }
        if note.hold_ticks == 0 {
            set_cell(cells, start, lane, b'X')?;
        } else {
            set_cell(cells, start, lane, b'M')?;
            for row in start.checked_add(1).ok_or(UcsError::Overflow)?..end {
                set_cell(cells, row, lane, b'H')?;
            }
            set_cell(cells, end, lane, b'W')?;
        }
    }
    Ok(())
}

fn set_cell(cells: &mut [Vec<u8>], row: u64, lane: usize, value: u8) -> Result<(), UcsError> {
    let cell = cells
        .get_mut(usize::try_from(row).map_err(|_| UcsError::Overflow)?)
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

fn write_header(
    output: &mut String,
    segment: &TempoSegment,
    delay_micros: i64,
    split: u64,
) -> Result<(), UcsError> {
    let bpm_numerator = 60_000_000_u128
        .checked_mul(segment.micros_per_beat.denominator())
        .ok_or(UcsError::Overflow)?;
    let bpm = format_decimal(bpm_numerator, segment.micros_per_beat.numerator(), 6)?;
    let delay_magnitude = u128::from(delay_micros.unsigned_abs());
    if delay_magnitude > JS_SAFE {
        return Err(UcsError::Unrepresentable(
            "offset exceeds the Studio numeric profile",
        ));
    }
    let delay = format_decimal(delay_magnitude, 1_000, 3)?;
    output.push_str(":BPM=");
    output.push_str(&bpm);
    output.push_str("\r\n:Delay=");
    if delay_micros < 0 {
        output.push('-');
    }
    output.push_str(&delay);
    output.push_str("\r\n:Beat=4\r\n:Split=");
    output.push_str(&split.to_string());
    output.push_str("\r\n");
    Ok(())
}

const fn gcd64(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}
