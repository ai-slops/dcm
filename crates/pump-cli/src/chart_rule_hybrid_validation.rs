use anyhow::{Context, Result, ensure};
use pump_chart::Note;

use crate::chart_rule_model::AutomaticRegion;

pub(crate) fn validate_ucs_cells(notes: &[Note]) -> Result<()> {
    let mut ends = [None; 10];
    for note in notes {
        for (panel, end) in ends.iter_mut().enumerate() {
            if note.panel_mask & (1 << panel) == 0 {
                continue;
            }
            ensure!(
                end.is_none_or(|previous| previous < note.tick),
                "lane {} tick {} already contains a note or hold tail",
                panel + 1,
                note.tick
            );
            *end = Some(
                note.tick
                    .checked_add(note.hold_ticks)
                    .context("note tail overflow")?,
            );
        }
    }
    Ok(())
}

pub(crate) const fn note_intersects_region(note: &Note, region: &AutomaticRegion) -> bool {
    note.tick < region.rules.end_tick
        && note.tick.saturating_add(note.hold_ticks) >= region.rules.start_tick
}

pub(crate) fn is_canonical_uuid(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 8 | 13 | 18 | 23)
                || byte.is_ascii_digit()
                || matches!(byte, b'a'..=b'f')
        })
}
