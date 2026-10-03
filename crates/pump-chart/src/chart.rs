use std::collections::BTreeMap;

use crate::{Chart, Frame, Note, PANEL_MASK, ValidationError};

pub fn normalize_chart(chart: &Chart) -> Result<Chart, ValidationError> {
    let mut sorted = chart.clone();
    sorted
        .notes
        .sort_unstable_by_key(|note| (note.tick, note.hold_ticks, note.panel_mask));
    validate_demands(&sorted, false)?;
    let mut notes: Vec<Note> = Vec::with_capacity(sorted.notes.len());
    for note in sorted.notes {
        if let Some(previous) = notes.last_mut()
            && previous.tick == note.tick
            && previous.hold_ticks == note.hold_ticks
        {
            previous.panel_mask |= note.panel_mask;
        } else {
            notes.push(note);
        }
    }
    let normalized = Chart {
        ticks_per_beat: sorted.ticks_per_beat,
        span_ticks: sorted.span_ticks,
        notes,
    };
    validate_chart(&normalized)?;
    Ok(normalized)
}

pub fn validate_chart(chart: &Chart) -> Result<(), ValidationError> {
    validate_demands(chart, true)
}

fn validate_demands(chart: &Chart, require_grouped: bool) -> Result<(), ValidationError> {
    if chart.ticks_per_beat == 0 {
        return Err(ValidationError::InvalidGrid);
    }
    if chart.span_ticks == 0 {
        return Err(ValidationError::InvalidSpan);
    }
    for pair in chart.notes.windows(2) {
        let left = (pair[0].tick, pair[0].hold_ticks, pair[0].panel_mask);
        let right = (pair[1].tick, pair[1].hold_ticks, pair[1].panel_mask);
        if left > right
            || (require_grouped
                && pair[0].tick == pair[1].tick
                && pair[0].hold_ticks == pair[1].hold_ticks)
        {
            return Err(ValidationError::NonCanonicalNotes);
        }
    }
    let mut active_until = [0_u64; 10];
    for note in &chart.notes {
        if note.panel_mask == 0 || note.panel_mask & !PANEL_MASK != 0 {
            return Err(ValidationError::InvalidPanelMask(note.panel_mask));
        }
        let end = note
            .tick
            .checked_add(note.hold_ticks)
            .ok_or(ValidationError::Overflow)?;
        if (note.hold_ticks == 0 && note.tick >= chart.span_ticks)
            || (note.hold_ticks > 0 && end > chart.span_ticks)
        {
            return Err(ValidationError::NoteOutsideSpan);
        }
        for panel in 0..10_u32 {
            if note.panel_mask & (1_u16 << panel) == 0 {
                continue;
            }
            let index = usize::try_from(panel).map_err(|_| ValidationError::Overflow)?;
            if active_until[index] > note.tick {
                return Err(ValidationError::OverlappingDemand);
            }
            active_until[index] = if note.hold_ticks == 0 {
                note.tick.checked_add(1).ok_or(ValidationError::Overflow)?
            } else {
                end
            };
        }
    }
    Ok(())
}

pub fn frames(chart: &Chart) -> Result<Vec<Frame>, ValidationError> {
    validate_chart(chart)?;
    let mut by_tick = BTreeMap::<u64, Frame>::new();
    for tick in [0, chart.span_ticks] {
        by_tick.insert(
            tick,
            Frame {
                tick,
                releases: 0,
                presses: 0,
                taps: 0,
            },
        );
    }
    for note in &chart.notes {
        let frame = by_tick.entry(note.tick).or_insert(Frame {
            tick: note.tick,
            releases: 0,
            presses: 0,
            taps: 0,
        });
        if note.hold_ticks == 0 {
            frame.taps |= note.panel_mask;
        } else {
            frame.presses |= note.panel_mask;
            let end = note
                .tick
                .checked_add(note.hold_ticks)
                .ok_or(ValidationError::Overflow)?;
            by_tick
                .entry(end)
                .or_insert(Frame {
                    tick: end,
                    releases: 0,
                    presses: 0,
                    taps: 0,
                })
                .releases |= note.panel_mask;
        }
    }
    Ok(by_tick.into_values().collect())
}

pub(crate) const fn note(tick: u64, panel_mask: u16, hold_ticks: u64) -> Note {
    Note {
        tick,
        panel_mask,
        hold_ticks,
    }
}
