use crate::{EvalError, IntentKind};
use pump_chart::{Chart, Music, Note};

pub(crate) struct Detection {
    pub(crate) units: Vec<Vec<u32>>,
    pub(crate) explanation: &'static str,
}

pub(crate) fn detect(
    chart: &Chart,
    music: &Music,
    kind: &IntentKind,
    work: &mut u64,
    limit: u64,
) -> Result<Detection, EvalError> {
    match kind {
        IntentKind::ReferenceAccents { tolerance_ticks } => {
            accents(chart, music, *tolerance_ticks, work, limit)
        }
        IntentKind::NegativeSpace {
            start_tick,
            end_tick,
        } => negative_space(chart, *start_tick, *end_tick, work, limit),
        IntentKind::RelationalMotif {
            minimum_notes,
            mirror_equivalent,
        } => motif(chart, *minimum_notes, *mirror_equivalent, work, limit),
    }
}

fn accents(
    chart: &Chart,
    music: &Music,
    tolerance: u64,
    work: &mut u64,
    limit: u64,
) -> Result<Detection, EvalError> {
    let mut units = Vec::new();
    let mut next_note = 0;
    for accent in &music.reference_accents {
        while let Some(note) = chart.notes.get(next_note) {
            take_work(work, limit)?;
            if note.tick < accent.saturating_sub(tolerance) {
                next_note += 1;
                continue;
            }
            if note.tick.abs_diff(*accent) <= tolerance {
                let note_index =
                    u32::try_from(next_note).map_err(|_| EvalError::ArithmeticOverflow)?;
                units.push(vec![note_index]);
                next_note += 1;
            }
            break;
        }
    }
    Ok(Detection {
        units,
        explanation: "reference accents matched by concrete note ticks",
    })
}

fn negative_space(
    chart: &Chart,
    start: u64,
    end: u64,
    work: &mut u64,
    limit: u64,
) -> Result<Detection, EvalError> {
    let mut clear = true;
    for note in &chart.notes {
        take_work(work, limit)?;
        let note_end = note.tick.saturating_add(note.hold_ticks.max(1));
        if note_end > start && note.tick < end {
            clear = false;
            break;
        }
    }
    Ok(Detection {
        units: if clear { vec![Vec::new()] } else { Vec::new() },
        explanation: "configured interval contains no tap or hold occupancy",
    })
}

fn motif(
    chart: &Chart,
    minimum_notes: u32,
    mirror_equivalent: bool,
    work: &mut u64,
    limit: u64,
) -> Result<Detection, EvalError> {
    let length = usize::try_from(minimum_notes).map_err(|_| EvalError::ArithmeticOverflow)?;
    if length == 0 || chart.notes.len() < length.saturating_mul(2) {
        return Ok(missing());
    }
    for first in 0..=chart.notes.len() - length * 2 {
        for second in first + length..=chart.notes.len() - length {
            take_work(work, limit)?;
            let direct = related(
                &chart.notes[first..first + length],
                &chart.notes[second..second + length],
                false,
                work,
                limit,
            )?;
            let mirrored = mirror_equivalent
                && related(
                    &chart.notes[first..first + length],
                    &chart.notes[second..second + length],
                    true,
                    work,
                    limit,
                )?;
            if direct || mirrored {
                let units = (0..length)
                    .map(|offset| {
                        Ok(vec![
                            u32::try_from(first + offset)
                                .map_err(|_| EvalError::ArithmeticOverflow)?,
                            u32::try_from(second + offset)
                                .map_err(|_| EvalError::ArithmeticOverflow)?,
                        ])
                    })
                    .collect::<Result<Vec<_>, EvalError>>()?;
                return Ok(Detection {
                    units,
                    explanation: if mirrored {
                        "mirror-equivalent note relation repeats"
                    } else {
                        "note relation repeats"
                    },
                });
            }
        }
    }
    Ok(missing())
}

fn related(
    first: &[Note],
    second: &[Note],
    mirrored: bool,
    work: &mut u64,
    limit: u64,
) -> Result<bool, EvalError> {
    let first_tick = first.first().map_or(0, |note| note.tick);
    let second_tick = second.first().map_or(0, |note| note.tick);
    for (left, right) in first.iter().zip(second) {
        take_work(work, limit)?;
        let panels_match = if mirrored {
            mirror(left.panel_mask) == right.panel_mask
        } else {
            left.panel_mask == right.panel_mask
        };
        if left.tick - first_tick != right.tick - second_tick
            || !panels_match
            || left.hold_ticks != right.hold_ticks
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn missing() -> Detection {
    Detection {
        units: Vec::new(),
        explanation: "no repeated relational motif",
    }
}

fn mirror(mask: u16) -> u16 {
    const MAP: [u8; 10] = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    MAP.iter()
        .enumerate()
        .fold(0_u16, |output, (source, target)| {
            if mask & (1_u16 << source) != 0 {
                output | (1_u16 << target)
            } else {
                output
            }
        })
}

pub(crate) fn take_work(work: &mut u64, limit: u64) -> Result<(), EvalError> {
    *work = work.checked_add(1).ok_or(EvalError::ArithmeticOverflow)?;
    if *work > limit {
        Err(EvalError::MatchingBudget { limit })
    } else {
        Ok(())
    }
}
