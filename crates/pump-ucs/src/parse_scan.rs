use crate::decimal::{Decimal, parse_signed_micros, parse_unsigned};
use crate::{UcsError, UcsMode};

const MAX_ROWS: usize = 1_000_000;
const MAX_SECTIONS: usize = 4_096;

#[derive(Default)]
pub(crate) struct Section<'a> {
    pub bpm: Option<Decimal>,
    pub delay_micros: Option<i64>,
    pub beat: Option<u32>,
    pub split: Option<u32>,
    pub rows: Vec<(usize, &'a str)>,
}

pub(crate) struct Document<'a> {
    pub mode: UcsMode,
    pub sections: Vec<Section<'a>>,
}

pub(crate) fn scan(text: &str) -> Result<Document<'_>, UcsError> {
    let mut format = None;
    let mut mode = None;
    let mut sections = vec![Section::default()];
    let mut saw_rows = false;
    let mut total_rows = 0_usize;
    for (index, raw) in text.lines().enumerate() {
        let line_number = index + 1;
        let line = raw;
        if line.is_empty() {
            continue;
        }
        if let Some(directive) = line.strip_prefix(':') {
            if saw_rows {
                if sections.len() >= MAX_SECTIONS {
                    return Err(UcsError::Limit("section count"));
                }
                sections.push(Section::default());
                saw_rows = false;
            }
            let (name, value) = directive
                .split_once('=')
                .ok_or_else(|| UcsError::malformed(line_number, "directive needs '='"))?;
            apply_directive(
                name,
                value,
                line_number,
                &mut format,
                &mut mode,
                sections.last_mut().ok_or(UcsError::Overflow)?,
            )?;
        } else {
            if format != Some(1) || mode.is_none() {
                return Err(UcsError::malformed(
                    line_number,
                    "Format and Mode must precede rows",
                ));
            }
            sections
                .last_mut()
                .ok_or(UcsError::Overflow)?
                .rows
                .push((line_number, line));
            saw_rows = true;
            total_rows = total_rows.checked_add(1).ok_or(UcsError::Overflow)?;
            if total_rows > MAX_ROWS {
                return Err(UcsError::Limit("row count"));
            }
        }
    }
    finish(text, format, mode, sections)
}

fn finish<'a>(
    text: &'a str,
    format: Option<u8>,
    mode: Option<UcsMode>,
    sections: Vec<Section<'a>>,
) -> Result<Document<'a>, UcsError> {
    if format != Some(1) || mode.is_none() {
        return Err(UcsError::malformed(1, "Format=1 and Mode are required"));
    }
    if sections.iter().any(|section| section.rows.is_empty()) {
        return Err(UcsError::malformed(
            text.lines().count().max(1),
            "empty or trailing section",
        ));
    }
    Ok(Document {
        mode: mode.ok_or(UcsError::Overflow)?,
        sections,
    })
}

fn apply_directive(
    name: &str,
    value: &str,
    line: usize,
    format: &mut Option<u8>,
    mode: &mut Option<UcsMode>,
    section: &mut Section<'_>,
) -> Result<(), UcsError> {
    match name {
        "Format" => parse_format(value, line, format)?,
        "Mode" => parse_mode(value, line, mode)?,
        "BPM" | "Delay" | "Beat" | "Split" if format.is_none() || mode.is_none() => {
            return Err(UcsError::malformed(
                line,
                "Format and Mode must precede timing directives",
            ));
        }
        "BPM" => set_once(&mut section.bpm, parse_unsigned(value, line, 6)?, line)?,
        "Delay" => set_once(
            &mut section.delay_micros,
            parse_signed_micros(value, line)?,
            line,
        )?,
        "Beat" => set_once(
            &mut section.beat,
            parse_integer(value, line, "invalid Beat")?,
            line,
        )?,
        "Split" => set_once(
            &mut section.split,
            parse_integer(value, line, "invalid Split")?,
            line,
        )?,
        _ => return Err(UcsError::unsupported(line, "unknown directive")),
    }
    Ok(())
}

fn parse_format(value: &str, line: usize, format: &mut Option<u8>) -> Result<(), UcsError> {
    set_once(format, parse_integer(value, line, "invalid Format")?, line)?;
    if *format != Some(1) {
        return Err(UcsError::unsupported(line, "only Format=1 is supported"));
    }
    Ok(())
}

fn parse_mode(value: &str, line: usize, mode: &mut Option<UcsMode>) -> Result<(), UcsError> {
    let parsed = match value {
        "Single" => UcsMode::Single,
        "Double" => UcsMode::Double,
        _ => return Err(UcsError::unsupported(line, "Mode must be Single or Double")),
    };
    set_once(mode, parsed, line)
}

fn parse_integer<T: std::str::FromStr>(
    value: &str,
    line: usize,
    message: &'static str,
) -> Result<T, UcsError> {
    value
        .parse()
        .map_err(|_| UcsError::malformed(line, message))
}

fn set_once<T>(slot: &mut Option<T>, value: T, line: usize) -> Result<(), UcsError> {
    if slot.replace(value).is_some() {
        return Err(UcsError::malformed(line, "duplicate directive"));
    }
    Ok(())
}
