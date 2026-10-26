use pump_chart::{Chart, Fraction, Music, Note, TempoSegment, normalize_chart};

use crate::decimal::{JS_SAFE, lcm};
use crate::parse_scan::{Document, scan};
use crate::{UcsChart, UcsError, UcsMode};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_NOTES: usize = 10_000;
const MAX_RAW_NOTES: usize = 10 * MAX_NOTES;

pub fn parse_ucs(bytes: &[u8], audio_sha256: [u8; 32]) -> Result<UcsChart, UcsError> {
    if bytes.len() > MAX_BYTES {
        return Err(UcsError::Limit("byte count"));
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if !bytes.is_ascii() {
        return Err(UcsError::Encoding);
    }
    validate_line_endings(bytes)?;
    let text = std::str::from_utf8(bytes).map_err(|_| UcsError::Encoding)?;
    let document = scan(text)?;
    build(document, audio_sha256)
}

fn build(document: Document<'_>, audio_sha256: [u8; 32]) -> Result<UcsChart, UcsError> {
    let first = document.sections.first().ok_or(UcsError::Overflow)?;
    if first.bpm.is_none() || first.beat.is_none() || first.split.is_none() {
        return Err(UcsError::malformed(
            1,
            "first section requires BPM, Beat, and Split",
        ));
    }
    let mut tpb = 1_u32;
    let mut inherited_split = None;
    for section in &document.sections {
        inherited_split = section.split.or(inherited_split);
        let split = inherited_split.ok_or_else(|| UcsError::malformed(1, "missing Split"))?;
        if !(1..=128).contains(&split) {
            return Err(UcsError::unsupported(1, "Split must be between 1 and 128"));
        }
        tpb = lcm(tpb, split)?;
        if tpb > 4_096 {
            return Err(UcsError::Limit("global timing grid"));
        }
    }
    build_on_grid(document, audio_sha256, tpb)
}

fn build_on_grid(
    document: Document<'_>,
    audio_sha256: [u8; 32],
    tpb: u32,
) -> Result<UcsChart, UcsError> {
    let mut notes = Vec::new();
    let mut tempo = Vec::new();
    let mut active = [None; 10];
    let mut tick = 0_u64;
    let mut bpm = None;
    let mut beat = None;
    let mut split = None;
    let mut offset = 0_i64;
    for (section_index, section) in document.sections.into_iter().enumerate() {
        bpm = section.bpm.or(bpm);
        beat = section.beat.or(beat);
        split = section.split.or(split);
        let section_bpm = bpm.ok_or(UcsError::Overflow)?;
        if section_bpm.numerator == 0 {
            return Err(UcsError::unsupported(1, "BPM must be positive"));
        }
        if beat != Some(4) {
            return Err(UcsError::unsupported(
                1,
                "only Beat=4 is timing-inert and supported",
            ));
        }
        let section_split = split.ok_or(UcsError::Overflow)?;
        let delay = section.delay_micros.unwrap_or(0);
        if section_index == 0 {
            offset = delay;
        } else if delay != 0 {
            return Err(UcsError::unsupported(
                1,
                "later nonzero Delay cannot represent a stop",
            ));
        }
        let mpb = fraction(
            60_000_000_u128
                .checked_mul(section_bpm.denominator)
                .ok_or(UcsError::Overflow)?,
            section_bpm.numerator,
        )?;
        if tempo
            .last()
            .is_none_or(|previous: &TempoSegment| previous.micros_per_beat != mpb)
        {
            tempo.push(TempoSegment {
                start_tick: tick,
                micros_per_beat: mpb,
            });
        }
        let advance = u64::from(tpb / section_split);
        for (line, row) in section.rows {
            parse_row(row, line, document.mode, tick, &mut active, &mut notes)?;
            if notes.len() > MAX_RAW_NOTES {
                return Err(UcsError::Limit("raw lane note count"));
            }
            tick = tick.checked_add(advance).ok_or(UcsError::Overflow)?;
            if tick > 1_000_000 {
                return Err(UcsError::Limit("derived duration"));
            }
        }
    }
    if active.iter().any(Option::is_some) {
        return Err(UcsError::malformed(1, "unfinished hold"));
    }
    let chart = normalize_chart(&Chart {
        ticks_per_beat: tpb,
        span_ticks: tick,
        notes,
    })
    .map_err(|error| UcsError::Chart(error.to_string()))?;
    if chart.notes.len() > MAX_NOTES {
        return Err(UcsError::Limit("canonical note count"));
    }
    let music = Music {
        duration_ticks: tick,
        ticks_per_beat: tpb,
        offset_micros: offset,
        tempo,
        audio_sha256,
        reference_accents: Vec::new(),
    };
    pump_chart::validate_music(&music).map_err(|error| UcsError::Music(error.to_string()))?;
    Ok(UcsChart {
        mode: document.mode,
        chart,
        music,
    })
}

fn validate_line_endings(bytes: &[u8]) -> Result<(), UcsError> {
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            return Err(UcsError::malformed(
                1,
                "carriage return must be followed by line feed",
            ));
        }
    }
    Ok(())
}

fn parse_row(
    row: &str,
    line: usize,
    mode: UcsMode,
    tick: u64,
    active: &mut [Option<u64>; 10],
    notes: &mut Vec<Note>,
) -> Result<(), UcsError> {
    if row.len() != mode.lanes() {
        return Err(UcsError::malformed(line, "row width does not match Mode"));
    }
    for (lane, cell) in row.bytes().enumerate() {
        let mask = 1_u16
            .checked_shl(u32::try_from(lane).map_err(|_| UcsError::Overflow)?)
            .ok_or(UcsError::Overflow)?;
        match (cell, active[lane]) {
            (b'.', None) => {}
            (b'X', None) => notes.push(Note {
                tick,
                panel_mask: mask,
                hold_ticks: 0,
            }),
            (b'M', None) => active[lane] = Some(tick),
            (b'H', Some(_)) => {}
            (b'W', Some(start)) if tick > start => {
                active[lane] = None;
                notes.push(Note {
                    tick: start,
                    panel_mask: mask,
                    hold_ticks: tick - start,
                });
            }
            (b'.', Some(_)) => return Err(UcsError::malformed(line, "hold interior must use H")),
            (b'H' | b'W', None) => {
                return Err(UcsError::malformed(line, "stray hold body or tail"));
            }
            (b'X' | b'M', Some(_)) => {
                return Err(UcsError::malformed(line, "overlapping hold onset"));
            }
            (b'W', Some(_)) => {
                return Err(UcsError::malformed(line, "hold tail must follow its head"));
            }
            _ => return Err(UcsError::malformed(line, "invalid row cell")),
        }
    }
    Ok(())
}

fn fraction(numerator: u128, denominator: u128) -> Result<Fraction, UcsError> {
    let value = Fraction::new(numerator, denominator).map_err(|_| UcsError::Overflow)?;
    if value.numerator() > JS_SAFE || value.denominator() > JS_SAFE {
        return Err(UcsError::Limit("JavaScript-safe fraction component"));
    }
    Ok(value)
}
