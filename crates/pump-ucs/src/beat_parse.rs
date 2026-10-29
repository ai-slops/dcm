use pump_chart::Fraction;

use crate::beat::{Beat, BeatGridSection, BeatNote, BeatTempoSegment, BeatUcsChart};
use crate::decimal::JS_SAFE;
use crate::parse_scan::{Document, scan};
use crate::{UcsError, UcsMode};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_NOTES: usize = 10_000;
const MAX_RAW_NOTES: usize = 10 * MAX_NOTES;

pub fn parse_ucs_beats(bytes: &[u8], audio_sha256: [u8; 32]) -> Result<BeatUcsChart, UcsError> {
    if bytes.len() > MAX_BYTES {
        return Err(UcsError::Limit("byte count"));
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if !bytes.is_ascii() {
        return Err(UcsError::Encoding);
    }
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            return Err(UcsError::malformed(
                1,
                "carriage return must be followed by line feed",
            ));
        }
    }
    let text = std::str::from_utf8(bytes).map_err(|_| UcsError::Encoding)?;
    build(scan(text)?, audio_sha256)
}

fn build(document: Document<'_>, audio_sha256: [u8; 32]) -> Result<BeatUcsChart, UcsError> {
    let first = document.sections.first().ok_or(UcsError::Overflow)?;
    if first.bpm.is_none() || first.beat.is_none() || first.split.is_none() {
        return Err(UcsError::malformed(
            1,
            "first section requires BPM, Beat, and Split",
        ));
    }
    let mut notes = Vec::new();
    let mut active = [None; 10];
    let mut tempo = Vec::new();
    let mut grid_sections = Vec::new();
    let mut at = Beat::new(0, 1)?;
    let mut bpm = None;
    let mut beat = None;
    let mut split = None;
    let mut offset_micros = 0;
    for (index, section) in document.sections.into_iter().enumerate() {
        bpm = section.bpm.or(bpm);
        beat = section.beat.or(beat);
        let previous_split = split;
        split = section.split.or(split);
        if beat != Some(4) {
            return Err(UcsError::unsupported(
                1,
                "only Beat=4 is timing-inert and supported",
            ));
        }
        let section_split = split.ok_or(UcsError::Overflow)?;
        if !(1..=128).contains(&section_split) {
            return Err(UcsError::unsupported(1, "Split must be between 1 and 128"));
        }
        let delay = section.delay_micros.unwrap_or(0);
        if index == 0 {
            offset_micros = delay;
        } else if delay != 0 {
            return Err(UcsError::unsupported(
                1,
                "later nonzero Delay cannot represent a stop",
            ));
        }
        let section_bpm = bpm.ok_or(UcsError::Overflow)?;
        if section_bpm.numerator == 0 {
            return Err(UcsError::unsupported(1, "BPM must be positive"));
        }
        let micros_per_beat = Fraction::new(
            60_000_000_u128
                .checked_mul(section_bpm.denominator)
                .ok_or(UcsError::Overflow)?,
            section_bpm.numerator,
        )
        .map_err(|_| UcsError::Overflow)?;
        if micros_per_beat.numerator() > JS_SAFE || micros_per_beat.denominator() > JS_SAFE {
            return Err(UcsError::Limit("JavaScript-safe fraction component"));
        }
        if tempo
            .last()
            .is_none_or(|last: &BeatTempoSegment| last.micros_per_beat != micros_per_beat)
        {
            tempo.push(BeatTempoSegment {
                at,
                micros_per_beat,
            });
        }
        if previous_split != Some(section_split) {
            grid_sections.push(BeatGridSection {
                at,
                rows_per_measure: u16::try_from(
                    section_split.checked_mul(4).ok_or(UcsError::Overflow)?,
                )
                .map_err(|_| UcsError::Overflow)?,
            });
        }
        let advance = Beat::new(1, u64::from(section_split))?;
        for (line, row) in section.rows {
            parse_row(row, line, document.mode, at, &mut active, &mut notes)?;
            if notes.len() > MAX_RAW_NOTES {
                return Err(UcsError::Limit("raw lane note count"));
            }
            at = at.checked_add(advance)?;
        }
    }
    if active.iter().any(Option::is_some) {
        return Err(UcsError::malformed(1, "unfinished hold"));
    }
    notes.sort_by_key(|note| (note.at, note.hold, note.panel_mask));
    let mut merged: Vec<BeatNote> = Vec::new();
    for note in notes {
        if let Some(previous) = merged
            .last_mut()
            .filter(|previous| previous.at == note.at && previous.hold == note.hold)
        {
            previous.panel_mask |= note.panel_mask;
        } else {
            merged.push(note);
        }
    }
    if merged.len() > MAX_NOTES {
        return Err(UcsError::Limit("canonical note count"));
    }
    Ok(BeatUcsChart {
        mode: document.mode,
        offset_micros,
        tempo,
        grid_sections,
        duration: at,
        notes: merged,
        audio_sha256,
        reference_accents: Vec::new(),
    })
}

fn parse_row(
    row: &str,
    line: usize,
    mode: UcsMode,
    at: Beat,
    active: &mut [Option<Beat>; 10],
    notes: &mut Vec<BeatNote>,
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
            (b'X', None) => notes.push(BeatNote {
                at,
                hold: Beat::new(0, 1)?,
                panel_mask: mask,
            }),
            (b'M', None) => active[lane] = Some(at),
            (b'H', Some(_)) => {}
            (b'W', Some(start)) if at > start => {
                active[lane] = None;
                notes.push(BeatNote {
                    at: start,
                    hold: at.checked_sub(start)?,
                    panel_mask: mask,
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
